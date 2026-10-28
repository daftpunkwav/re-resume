/**
 * @file CustomModuleRepository
 * @description Persistence port of the custom module definitions. A definition
 * and the entries that name it are written together where the operation touches
 * both.
 *
 * Constraints:
 * - Only domain types: the repository interface never names a database row.
 * - `delete` receives the entries the caller read, so the implementation can
 *   refuse a delete whose reported cascade no longer matches what the module
 *   owns: the change record would otherwise not be a faithful inverse.
 * - The inverse path reuses the same methods: a write that carries a record
 *   already in the log stamps that record undone instead of appending a second
 *   one, so the inverse state change and its audit stamp share one transaction.
 *   `insert` therefore accepts the entries a deletion removed and `update`
 *   accepts the values a field removal cleared.
 */

import type { ChangeRecord } from '../../changes/ChangeRecord'
import type { CustomModuleId, CustomFieldKey, InfoEntryId } from '../../shared/branded-id'
import type { CustomModuleDefinition } from '../CustomModule'
import type { InfoEntry } from '../InfoEntry'
import type { InfoFieldValue } from '../InfoFieldValue'

/** One stored field value a definition update clears or restores. */
export interface CustomFieldValueChange {
  readonly entryId: InfoEntryId
  readonly fieldKey: CustomFieldKey
  /**
   * Present only on the undo path: the value the removal recorded is written
   * back instead of the key being cleared.
   */
  readonly restoredValue?: InfoFieldValue
}

export interface CustomModuleRepository {
  findById(id: CustomModuleId): Promise<CustomModuleDefinition | null>
  /** Definitions in `sortOrder` order. */
  listAll(): Promise<readonly CustomModuleDefinition[]>
  /**
   * Inserts the definition, optionally with the entries a deletion removed (the
   * undo path), and writes the change record, in one transaction.
   */
  insert(
    module: CustomModuleDefinition,
    change: ChangeRecord,
    restoredEntries?: readonly InfoEntry[],
  ): Promise<void>
  /**
   * Replaces the definition, applies the field value changes to the entries that
   * hold them, and writes the change record, in one transaction.
   */
  update(
    module: CustomModuleDefinition,
    fieldValueChanges: readonly CustomFieldValueChange[],
    change: ChangeRecord,
  ): Promise<void>
  /**
   * Deletes the entries and the definition and writes the change record, in one
   * transaction. `entries` is the caller's snapshot of the module's entries.
   */
  delete(
    id: CustomModuleId,
    entries: readonly InfoEntry[],
    change: ChangeRecord,
  ): Promise<void>
  /** Rewrites the sort order of the definitions to 1..n and writes the change record. */
  reorder(orderedIds: readonly CustomModuleId[], change: ChangeRecord): Promise<void>
}
