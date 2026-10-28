/**
 * @file InfoEntryRepository
 * @description Persistence port of the information entries. Every mutation
 * carries the change record that makes it reversible and stores both in one
 * transaction.
 *
 * Constraints:
 * - Read methods return domain values only; a row that violates the column
 *   contract is reported, never repaired.
 * - `sortOrder` is unique inside a module; `reorder` rewrites it densely.
 * - The inverse path reuses the same methods: a record whose identifier is
 *   already in the log is stamped undone instead of appended, so the inverse
 *   state change and its audit stamp share one transaction.
 */

import type { CustomModuleId, InfoEntryId } from '../../shared/branded-id'
import type { ChangeRecord } from '../../changes/ChangeRecord'
import type { InfoEntry } from '../InfoEntry'
import type { InfoModuleKind } from '../InfoModuleKind'

export interface InfoEntryRepository {
  findById(id: InfoEntryId): Promise<InfoEntry | null>
  listAll(): Promise<readonly InfoEntry[]>
  /** Entries of one module, in `sortOrder` order. */
  listByModule(
    moduleKind: InfoModuleKind,
    customModuleId: CustomModuleId | null,
  ): Promise<readonly InfoEntry[]>
  /** Inserts the entry and appends the change record in one transaction. */
  insert(entry: InfoEntry, change: ChangeRecord): Promise<void>
  /** Replaces the entry and appends the change record in one transaction. */
  update(entry: InfoEntry, change: ChangeRecord): Promise<void>
  /** Deletes the entry and appends the change record in one transaction. */
  delete(id: InfoEntryId, change: ChangeRecord): Promise<void>
  /**
   * Rewrites the sort order of the given entries to 1..n and appends the change
   * record, in one transaction. The identifiers must be exactly the module's
   * entries; the implementation rejects a set that no longer matches.
   */
  reorder(
    moduleKind: InfoModuleKind,
    customModuleId: CustomModuleId | null,
    orderedIds: readonly InfoEntryId[],
    change: ChangeRecord,
  ): Promise<void>
  countByModule(moduleKind: InfoModuleKind, customModuleId: CustomModuleId | null): Promise<number>
}
