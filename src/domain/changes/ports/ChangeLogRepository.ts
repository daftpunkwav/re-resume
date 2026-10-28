/**
 * @file ChangeLogRepository
 * @description Reads and stamps the append-only change records. The writers of
 * the records are the entity repositories, which insert the record in the same
 * transaction as the write it describes; this port covers the read side and the
 * undo stamp.
 *
 * Constraints:
 * - Only domain types: the repository interface never names a database row.
 * - `append` inserts; stamping an existing record is `markUndone`.
 */

import type { ChangeRecordId } from '../../shared/branded-id'
import type { DateTime } from '../../shared/DateTime'
import type { ChangeRecord } from '../ChangeRecord'

export interface ChangeLogRepository {
  findById(id: ChangeRecordId): Promise<ChangeRecord | null>
  /**
   * Newest record of one entity that has not been undone, or null when the
   * entity has no undoable write left.
   */
  latestLiveForEntity(entity: string, entityId: string): Promise<ChangeRecord | null>
  /** Newest records first, for the history view. */
  listRecent(limit: number): Promise<readonly ChangeRecord[]>
  append(record: ChangeRecord): Promise<void>
  markUndone(id: ChangeRecordId, undoneAt: DateTime): Promise<void>
}
