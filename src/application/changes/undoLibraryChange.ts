/**
 * @file undoLibraryChange
 * @description Reverses one recorded write outside the resume document.
 *
 * Responsibilities:
 * - Enforce the four undo rules: the record exists, it is not already undone,
 *   it is still the newest live record for its entity, and it may be reversed
 * - Dispatch the inverse operation for the recorded operation kind
 * - Stamp `undoneAt`; the record itself is never deleted or rewritten otherwise
 *
 * Constraints:
 * - The inverse runs before the marker. Operations are re-runnable — deleting a
 *   deleted row, restoring the same payload twice, rewriting an order twice are
 *   all no-ops — while a marker without an applied inverse would hide the fact
 *   that the data is still changed.
 * - Entity writes go through an injected writer. The information-library
 *   repositories own those transaction boundaries and this use case owns the
 *   ordering rules, so the same four rules serve every scope.
 * - An inverse never produces a new change record: `undoneAt` is the audit.
 */

import type { ChangeRecord } from '../../domain/changes/ChangeRecord'
import type { ChangeLogRepository } from '../../domain/changes/ports/ChangeLogRepository'
import { DomainError } from '../../domain/shared/DomainError'
import type { Clock } from '../../domain/shared/Clock'
import type { ChangeRecordId } from '../../domain/shared/branded-id'

/**
 * The entity writes an undo needs. Implementations live beside the repositories
 * that own the data; this interface is the only shape the change log depends on.
 */
export interface LibraryChangeInverseWriter {
  /** Removes the row a `*.create` record added. */
  deleteEntity(entity: string, entityId: string): Promise<void>
  /** Puts the row back as `beforeJson` describes it (`*.update`, `infoEntry.delete`). */
  restoreEntity(entity: string, entityId: string, beforeJson: string): Promise<void>
  /** Puts a deleted custom module back together with all of its entries. */
  restoreCustomModule(beforeJson: string): Promise<void>
  /** Restores the ordering captured in the record's before payload. */
  restoreEntityOrder(record: ChangeRecord): Promise<void>
}

export interface UndoLibraryChangeDeps {
  readonly changes: ChangeLogRepository
  readonly inverse: LibraryChangeInverseWriter
  readonly clock: Clock
}

export interface UndoLibraryChangeInput {
  readonly changeId: ChangeRecordId
}

export async function undoLibraryChange(
  deps: UndoLibraryChangeDeps,
  input: UndoLibraryChangeInput,
): Promise<ChangeRecord> {
  const record = await deps.changes.findById(input.changeId)
  if (record === null) {
    throw new DomainError('changeNotFound', '这条变更不存在。', {
      entity: 'changeRecord',
      id: input.changeId,
      blockers: [],
    })
  }
  if (record.undoneAt !== null) {
    throw new DomainError('changeAlreadyUndone', '这条变更已经撤销过了。', {
      entity: record.entity,
      id: record.entityId,
      blockers: [],
    })
  }
  const latest = await deps.changes.latestLiveForEntity(record.entity, record.entityId)
  if (latest !== null && latest.id !== record.id) {
    throw new DomainError('changeOutOfOrder', '这条变更之前还有更新的同实体变更，请先从最新一条开始撤销。', {
      entity: record.entity,
      id: record.entityId,
      blockers: [latest.id],
    })
  }

  await applyInverse(deps.inverse, record)
  const undoneAt = deps.clock.now()
  await deps.changes.markUndone(record.id, undoneAt)
  return { ...record, undoneAt }
}

async function applyInverse(
  inverse: LibraryChangeInverseWriter,
  record: ChangeRecord,
): Promise<void> {
  switch (record.op) {
    case 'infoEntry.create':
    case 'customModule.create':
    case 'jobPosting.create':
      await inverse.deleteEntity(record.entity, record.entityId)
      return
    case 'customModule.delete':
      // A deleted custom module takes its entries with it; the record stores
      // both, so they are restored together rather than one row at a time.
      await inverse.restoreCustomModule(requireBeforeJson(record))
      return
    case 'infoEntry.reorder':
    case 'customModule.reorder':
      await inverse.restoreEntityOrder(record)
      return
    case 'infoEntry.update':
    case 'infoEntry.delete':
    case 'customModule.update':
      await inverse.restoreEntity(record.entity, record.entityId, requireBeforeJson(record))
      return
  }
}

function requireBeforeJson(record: ChangeRecord): string {
  if (record.beforeJson === null) {
    throw new Error(
      `变更 ${record.id}（${record.op}）没有 beforeJson，无法执行逆操作。这是一条损坏的变更记录。`,
    )
  }
  return record.beforeJson
}
