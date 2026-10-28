/**
 * @file inMemoryInfoRepositories
 * @description Memory-backed implementations of the information-library ports for
 * the browser preview and the use-case tests. They keep the same observable
 * contract as the SQLite implementations — change records appended with every
 * mutation, order rewritten densely, a stale reorder refused — without a
 * database.
 *
 * Constraints:
 * - Preview and test support only. Nothing here reaches the disk, the network or
 *   the native container.
 * - Values are stored by reference, exactly as a row would keep columns: callers
 *   treat what they read as immutable.
 */

import type { ChangeRecord } from '../../domain/changes/ChangeRecord'
import type { ChangeLogRepository } from '../../domain/changes/ports/ChangeLogRepository'
import type { CustomModuleDefinition } from '../../domain/info/CustomModule'
import type { CustomFieldValueChange } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import { INFO_MODULE_KINDS } from '../../domain/info/InfoModuleKind'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type {
  InfoEntryReference,
  InfoEntryReferenceQuery,
} from '../../domain/info/ports/InfoEntryReferenceQuery'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type {
  ChangeRecordId,
  CustomModuleId,
  InfoEntryId,
} from '../../domain/shared/branded-id'
import type { DateTime } from '../../domain/shared/DateTime'

function moduleRank(moduleKind: InfoModuleKind): number {
  return INFO_MODULE_KINDS.indexOf(moduleKind)
}

function compareEntries(left: InfoEntry, right: InfoEntry): number {
  const kindDifference = moduleRank(left.moduleKind) - moduleRank(right.moduleKind)
  if (kindDifference !== 0) return kindDifference
  const leftModule = left.customModuleId ?? ''
  const rightModule = right.customModuleId ?? ''
  if (leftModule !== rightModule) return leftModule < rightModule ? -1 : 1
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function requireEntry(value: InfoEntry | null | undefined, id: InfoEntryId): InfoEntry {
  if (value === null || value === undefined) {
    throw new Error(`The in-memory library has no entry "${id}".`)
  }
  return value
}

/** Change records of a preview session, newest last. */
export class InMemoryChangeLogRepository implements ChangeLogRepository {
  readonly #records: ChangeRecord[]

  constructor(initial: readonly ChangeRecord[] = []) {
    this.#records = [...initial]
  }

  async findById(id: ChangeRecordId): Promise<ChangeRecord | null> {
    return this.#records.find((record) => record.id === id) ?? null
  }

  async latestLiveForEntity(entity: string, entityId: string): Promise<ChangeRecord | null> {
    const live = this.#records
      .filter(
        (record) => record.entity === entity && record.entityId === entityId && record.undoneAt === null,
      )
      .sort((left, right) => compareRecordsNewestFirst(left, right))
    return live[0] ?? null
  }

  async listRecent(limit: number): Promise<readonly ChangeRecord[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`A concrete recent-change limit is required, received ${String(limit)}.`)
    }
    return [...this.#records].sort(compareRecordsNewestFirst).slice(0, limit)
  }

  async append(record: ChangeRecord): Promise<void> {
    this.#records.push(record)
  }

  async markUndone(id: ChangeRecordId, undoneAt: DateTime): Promise<void> {
    const index = this.#records.findIndex((record) => record.id === id)
    if (index === -1) {
      throw new Error(`The in-memory change log has no record "${id}".`)
    }
    const record = this.#records[index] as ChangeRecord
    this.#records[index] = { ...record, undoneAt }
  }

  /**
   * The in-memory counterpart of the entity repositories' upsert: a fresh
   * identifier appends, the identifier of a record being undone stamps it.
   */
  record(change: ChangeRecord): void {
    const index = this.#records.findIndex((record) => record.id === change.id)
    if (index === -1) {
      this.#records.push(change)
      return
    }
    const stored = this.#records[index] as ChangeRecord
    this.#records[index] = { ...stored, undoneAt: change.undoneAt }
  }

  /** Every record, for assertions in use-case tests. */
  all(): readonly ChangeRecord[] {
    return [...this.#records]
  }
}

function compareRecordsNewestFirst(left: ChangeRecord, right: ChangeRecord): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0
}

export class InMemoryInfoEntryRepository implements InfoEntryRepository {
  readonly #entries = new Map<string, InfoEntry>()
  readonly #changes: InMemoryChangeLogRepository

  constructor(changes: InMemoryChangeLogRepository) {
    this.#changes = changes
  }

  /** Fills the store without producing change records; preview fixtures use this. */
  seed(entries: readonly InfoEntry[]): void {
    for (const entry of entries) this.#entries.set(entry.id, entry)
  }

  async findById(id: InfoEntryId): Promise<InfoEntry | null> {
    return this.#entries.get(id) ?? null
  }

  async listAll(): Promise<readonly InfoEntry[]> {
    return [...this.#entries.values()].sort(compareEntries)
  }

  async listByModule(
    moduleKind: InfoModuleKind,
    customModuleId: CustomModuleId | null,
  ): Promise<readonly InfoEntry[]> {
    return [...this.#entries.values()]
      .filter(
        (entry) => entry.moduleKind === moduleKind && entry.customModuleId === customModuleId,
      )
      .sort(compareEntries)
  }

  async insert(entry: InfoEntry, change: ChangeRecord): Promise<void> {
    if (this.#entries.has(entry.id)) {
      throw new Error(`The in-memory library already has an entry "${entry.id}".`)
    }
    this.#entries.set(entry.id, entry)
    this.#changes.record(change)
  }

  async update(entry: InfoEntry, change: ChangeRecord): Promise<void> {
    requireEntry(this.#entries.get(entry.id), entry.id)
    this.#entries.set(entry.id, entry)
    this.#changes.record(change)
  }

  async delete(id: InfoEntryId, change: ChangeRecord): Promise<void> {
    requireEntry(this.#entries.get(id), id)
    this.#entries.delete(id)
    this.#changes.record(change)
  }

  async reorder(
    moduleKind: InfoModuleKind,
    customModuleId: CustomModuleId | null,
    orderedIds: readonly InfoEntryId[],
    change: ChangeRecord,
  ): Promise<void> {
    const current = await this.listByModule(moduleKind, customModuleId)
    assertSameIdentifiers(
      'the module entries',
      current.map((entry) => entry.id),
      orderedIds,
    )
    orderedIds.forEach((id, index) => {
      const entry = requireEntry(this.#entries.get(id), id)
      this.#entries.set(id, { ...entry, sortOrder: index + 1 })
    })
    this.#changes.record(change)
  }

  async countByModule(
    moduleKind: InfoModuleKind,
    customModuleId: CustomModuleId | null,
  ): Promise<number> {
    return (await this.listByModule(moduleKind, customModuleId)).length
  }

  /** Inserts restored rows without producing change records; the undo path uses this. */
  restore(entries: readonly InfoEntry[]): void {
    for (const entry of entries) {
      if (this.#entries.has(entry.id)) {
        throw new Error(`The in-memory library already has an entry "${entry.id}".`)
      }
      this.#entries.set(entry.id, entry)
    }
  }

  /** Applies stored field value changes to an entry; a custom module update uses this. */
  applyFieldValueChanges(
    entryId: InfoEntryId,
    fieldValueChanges: readonly CustomFieldValueChange[],
    updatedAt: DateTime,
  ): void {
    const entry = requireEntry(this.#entries.get(entryId), entryId)
    const fields = { ...entry.fields }
    for (const change of fieldValueChanges) {
      if (change.restoredValue === undefined) {
        delete fields[change.fieldKey]
      } else {
        fields[change.fieldKey] = change.restoredValue
      }
    }
    this.#entries.set(entryId, { ...entry, fields, updatedAt })
  }

  /** Removes every entry of a module; used by the module delete. */
  removeByModule(moduleId: CustomModuleId): number {
    let removed = 0
    for (const [id, entry] of this.#entries) {
      if (entry.customModuleId === moduleId) {
        this.#entries.delete(id)
        removed += 1
      }
    }
    return removed
  }
}

export class InMemoryCustomModuleRepository implements CustomModuleRepository {
  readonly #modules = new Map<string, CustomModuleDefinition>()
  readonly #entries: InMemoryInfoEntryRepository
  readonly #changes: InMemoryChangeLogRepository

  constructor(entries: InMemoryInfoEntryRepository, changes: InMemoryChangeLogRepository) {
    this.#entries = entries
    this.#changes = changes
  }

  /** Fills the store without producing change records; preview fixtures use this. */
  seed(modules: readonly CustomModuleDefinition[]): void {
    for (const module of modules) this.#modules.set(module.id, module)
  }

  async findById(id: CustomModuleId): Promise<CustomModuleDefinition | null> {
    return this.#modules.get(id) ?? null
  }

  async listAll(): Promise<readonly CustomModuleDefinition[]> {
    return [...this.#modules.values()].sort((left, right) => left.sortOrder - right.sortOrder)
  }

  async insert(
    module: CustomModuleDefinition,
    change: ChangeRecord,
    restoredEntries: readonly InfoEntry[] = [],
  ): Promise<void> {
    if (this.#modules.has(module.id)) {
      throw new Error(`The in-memory library already has a custom module "${module.id}".`)
    }
    for (const entry of restoredEntries) {
      if (entry.customModuleId !== module.id) {
        throw new Error(
          `Cannot restore entry "${entry.id}" into module "${module.id}": ` +
            'the entry names a different module.',
        )
      }
    }
    this.#modules.set(module.id, module)
    this.#entries.restore(restoredEntries)
    this.#changes.record(change)
  }

  async update(
    module: CustomModuleDefinition,
    fieldValueChanges: readonly CustomFieldValueChange[],
    change: ChangeRecord,
  ): Promise<void> {
    if (!this.#modules.has(module.id)) {
      throw new Error(`The in-memory library has no custom module "${module.id}".`)
    }
    const changesByEntry = new Map<string, CustomFieldValueChange[]>()
    for (const fieldChange of fieldValueChanges) {
      const changes = changesByEntry.get(fieldChange.entryId) ?? []
      changes.push(fieldChange)
      changesByEntry.set(fieldChange.entryId, changes)
    }
    // Every entry is checked before any of them changes: an in-memory update
    // that failed halfway would leave the same half-applied state the SQL
    // transaction exists to prevent.
    for (const entryId of changesByEntry.keys()) {
      requireEntry(await this.#entries.findById(entryId as InfoEntryId), entryId as InfoEntryId)
    }
    for (const [entryId, changes] of changesByEntry) {
      this.#entries.applyFieldValueChanges(entryId as InfoEntryId, changes, module.updatedAt)
    }
    this.#modules.set(module.id, module)
    this.#changes.record(change)
  }

  async delete(
    id: CustomModuleId,
    entries: readonly InfoEntry[],
    change: ChangeRecord,
  ): Promise<void> {
    if (!this.#modules.has(id)) {
      throw new Error(`The in-memory library has no custom module "${id}".`)
    }
    const stored = (await this.#entries.listByModule('custom', id)).length
    if (stored !== entries.length) {
      throw new Error(
        `The custom module "${id}" owns ${stored.toString()} entries, but the caller reported ` +
          `${entries.length.toString()}: the change record would not be a faithful inverse.`,
      )
    }
    this.#entries.removeByModule(id)
    this.#modules.delete(id)
    this.#changes.record(change)
  }

  async reorder(orderedIds: readonly CustomModuleId[], change: ChangeRecord): Promise<void> {
    assertSameIdentifiers(
      'the custom modules',
      [...this.#modules.keys()],
      orderedIds,
    )
    orderedIds.forEach((id, index) => {
      const module = this.#modules.get(id)
      if (module === undefined) {
        throw new Error(`The in-memory library has no custom module "${id}".`)
      }
      this.#modules.set(id, { ...module, sortOrder: index + 1 })
    })
    this.#changes.record(change)
  }
}

function assertSameIdentifiers(
  what: string,
  current: readonly string[],
  requested: readonly string[],
): void {
  const unique = new Set(requested)
  if (unique.size !== requested.length) {
    throw new Error(`Cannot reorder ${what}: an identifier is listed twice.`)
  }
  if (current.length !== requested.length) {
    throw new Error(
      `Cannot reorder ${what}: ${current.length.toString()} rows are stored, ` +
        `${requested.length.toString()} were requested.`,
    )
  }
  const currentSet = new Set(current)
  for (const id of requested) {
    if (!currentSet.has(id)) throw new Error(`Cannot reorder ${what}: "${id}" is not part of it.`)
  }
}

/** Reference lists seeded per entry and per module; empty means nothing references it. */
export class InMemoryEntryReferenceQuery implements InfoEntryReferenceQuery {
  readonly #byEntry: ReadonlyMap<string, readonly InfoEntryReference[]>
  readonly #byModule: ReadonlyMap<string, readonly InfoEntryReference[]>

  constructor(options: {
    readonly byEntry?: ReadonlyMap<string, readonly InfoEntryReference[]>
    readonly byModule?: ReadonlyMap<string, readonly InfoEntryReference[]>
  } = {}) {
    this.#byEntry = options.byEntry ?? new Map()
    this.#byModule = options.byModule ?? new Map()
  }

  async listEntryReferences(entryId: InfoEntryId): Promise<readonly InfoEntryReference[]> {
    return this.#byEntry.get(entryId) ?? []
  }

  async listModuleReferences(moduleId: CustomModuleId): Promise<readonly InfoEntryReference[]> {
    return this.#byModule.get(moduleId) ?? []
  }
}
