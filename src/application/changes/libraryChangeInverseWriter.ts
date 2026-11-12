/**
 * @file libraryChangeInverseWriter
 * @description Replays a recorded library write backwards. The information
 * repositories are the undo seam: a mutation that carries the record being
 * undone stamps that record instead of appending a new one, so the inverse state
 * change and its audit stamp land in the same transaction.
 *
 * Responsibilities:
 * - Rebuild the removed domain value from the record's `beforeJson`
 * - Apply the inverse mutation through the same ports a normal write uses
 * - Refuse a change whose payload cannot be read back, instead of touching data
 *   with a guessed inverse
 *
 * Constraints:
 * - This module depends on the ports only: the same code serves SQLite and the
 *   preview library.
 * - The payloads are parsed by the domain pair in `changePayloads` — the same
 *   functions the write side serializes with — so an added field flows through
 *   and an unknown one is refused instead of silently dropped by an undo.
 * - A create is undone by deleting the row the record names; an update or a
 *   delete is undone by writing the recorded state back. The direction is decided
 *   by what is stored now, so the same method serves both.
 * - Job-posting records have no delete port to reverse them; the inverse reports
 *   that instead of silently doing nothing. No current writer produces one.
 * - A reorder is restored from the recorded order. The port requires the listed
 *   set to match the module's current set, so an entry added after the reorder
 *   makes that inverse refuse rather than silently renumber rows.
 */

import type { LibraryChangeInverseWriter } from './undoLibraryChange'
import type { ChangeRecord } from '../../domain/changes/ChangeRecord'
import type { ChangeLogRepository } from '../../domain/changes/ports/ChangeLogRepository'
import type { Clock } from '../../domain/shared/Clock'
import type { OrderMappingPayload } from '../../domain/info/changePayloads'
import {
  parseDeletedModulePayload,
  parseInfoEntryPayload,
  parseModuleUpdatePayload,
  parseOrderMappings,
  PayloadParseError,
} from '../../domain/info/changePayloads'
import type { CustomModuleId } from '../../domain/shared/branded-id'
import { asCustomModuleId, asInfoEntryId } from '../../domain/shared/branded-id'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import { isInfoModuleKind } from '../../domain/info/InfoModuleKind'
import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'

export interface LibraryChangeInverseWriterDeps {
  readonly changes: ChangeLogRepository
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly clock: Clock
}

/**
 * A payload written by the application itself, so a shape that no longer parses
 * means the record is not the value this build wrote. The refusal names the
 * record so the failure is diagnosable instead of appearing as a missing row.
 */
function corrupt(recordId: string | null, what: string): Error {
  const subject = recordId === null ? '变更记录' : `变更记录 ${recordId}`
  return new Error(`${subject}的${what}无法解析，无法安全地执行撤销。`)
}

function decodeJson(text: string, recordId: string | null, what: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw corrupt(recordId, what)
  }
}

/** Runs one domain payload parser; a contract refusal becomes the undo refusal. */
function parsePayload<T>(
  parse: (value: unknown) => T,
  value: unknown,
  recordId: string | null,
  what: string,
): T {
  try {
    return parse(value)
  } catch (failure) {
    if (failure instanceof PayloadParseError) throw corrupt(recordId, what)
    throw failure
  }
}

/** The live record for one entity; the use case has already checked it is the one being undone. */
async function liveRecord(
  deps: LibraryChangeInverseWriterDeps,
  entity: string,
  entityId: string,
): Promise<ChangeRecord> {
  const record = await deps.changes.latestLiveForEntity(entity, entityId)
  if (record === null) {
    throw new Error(`There is no record of a live change for ${entity} "${entityId}" to undo.`)
  }
  return record
}

function stamped(record: ChangeRecord, deps: LibraryChangeInverseWriterDeps): ChangeRecord {
  return { ...record, undoneAt: deps.clock.now() }
}

function reorderTarget(entityId: string): {
  readonly moduleKind: InfoModuleKind
  readonly customModuleId: CustomModuleId | null
} {
  return isInfoModuleKind(entityId)
    ? { moduleKind: entityId, customModuleId: null }
    : { moduleKind: 'custom', customModuleId: asCustomModuleId(entityId) }
}

function orderedIds(order: readonly OrderMappingPayload[]): readonly string[] {
  return [...order].sort((left, right) => left.sortOrder - right.sortOrder).map((entry) => entry.id)
}

/**
 * Undoes a recorded entry write: when the row is gone the inverse inserts the
 * recorded state, otherwise it rewrites it. The direction is decided by what is
 * stored now, so a create and a delete share the same path.
 */
async function restoreInfoEntry(
  deps: LibraryChangeInverseWriterDeps,
  beforeJson: string,
  entityId: string,
): Promise<void> {
  const what = `before 数据（infoEntry ${entityId}）`
  const entry = parsePayload(
    parseInfoEntryPayload,
    decodeJson(beforeJson, null, what),
    null,
    what,
  )
  const record = await liveRecord(deps, 'infoEntry', entityId)
  const current = await deps.entries.findById(entry.id)
  const stamp = stamped(record, deps)
  if (current === null) {
    await deps.entries.insert(entry, stamp)
    return
  }
  await deps.entries.update(entry, stamp)
}

/** Undoes a recorded module write, restoring the definition and any cleared values. */
async function restoreCustomModuleDefinition(
  deps: LibraryChangeInverseWriterDeps,
  beforeJson: string,
  entityId: string,
): Promise<void> {
  const what = `before 数据（customModule ${entityId}）`
  const { module, clearedValues: cleared } = parsePayload(
    parseModuleUpdatePayload,
    decodeJson(beforeJson, null, what),
    null,
    what,
  )
  const record = await liveRecord(deps, 'customModule', entityId)
  const current = await deps.customModules.findById(module.id)
  const stamp = stamped(record, deps)
  if (current === null) {
    await deps.customModules.insert(module, stamp)
    return
  }
  await deps.customModules.update(
    module,
    cleared.map((value) => ({
      entryId: value.entryId,
      fieldKey: value.fieldKey,
      restoredValue: value.value,
    })),
    stamp,
  )
}

export function createLibraryChangeInverseWriter(
  deps: LibraryChangeInverseWriterDeps,
): LibraryChangeInverseWriter {
  return {
    async deleteEntity(entity, entityId) {
      if (entity === 'infoEntry') {
        const record = await liveRecord(deps, entity, entityId)
        await deps.entries.delete(asInfoEntryId(entityId), stamped(record, deps))
        return
      }
      if (entity === 'customModule') {
        const record = await liveRecord(deps, entity, entityId)
        const moduleId = asCustomModuleId(entityId)
        // Undoing a module creation removes the module as it is now. Entries
        // added after the creation belong to no other module and would become
        // unreachable rows, so they go with it; their own records stay live and
        // a later undo of one is an idempotent refusal from the repository.
        const entries = await deps.entries.listByModule('custom', moduleId)
        await deps.customModules.delete(moduleId, entries, stamped(record, deps))
        return
      }
      throw new Error(`No persistence port can reverse a "${entity}" creation.`)
    },

    async restoreEntity(entity, entityId, beforeJson) {
      if (entity === 'infoEntry') {
        await restoreInfoEntry(deps, beforeJson, entityId)
        return
      }
      if (entity === 'customModule') {
        await restoreCustomModuleDefinition(deps, beforeJson, entityId)
        return
      }
      throw new Error(`No persistence port can restore a "${entity}" row.`)
    },

    async restoreEntityOrder(record) {
      const what = `before 数据（排序 ${record.entityId}）`
      const order = parsePayload(
        parseOrderMappings,
        decodeJson(record.beforeJson ?? '', record.id, what),
        record.id,
        what,
      )
      const ids = orderedIds(order)
      if (record.op === 'infoEntry.reorder') {
        const target = reorderTarget(record.entityId)
        await deps.entries.reorder(
          target.moduleKind,
          target.customModuleId,
          ids.map((id) => asInfoEntryId(id)),
          stamped(record, deps),
        )
        return
      }
      if (record.op === 'customModule.reorder') {
        await deps.customModules.reorder(
          ids.map((id) => asCustomModuleId(id)),
          stamped(record, deps),
        )
        return
      }
      throw new Error(`"${record.op}" is not an order operation.`)
    },

    async restoreCustomModule(beforeJson) {
      const what = 'before 数据（自定义模块）'
      const { module, entries } = parsePayload(
        parseDeletedModulePayload,
        decodeJson(beforeJson, null, what),
        null,
        what,
      )
      if (entries.some((entry: InfoEntry) => entry.customModuleId !== module.id)) {
        throw corrupt(null, what)
      }
      const record = await liveRecord(deps, 'customModule', module.id)
      await deps.customModules.insert(module, stamped(record, deps), entries)
    },
  }
}
