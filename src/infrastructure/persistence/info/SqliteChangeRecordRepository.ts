/**
 * @file SqliteChangeRecordRepository
 * @description SQLite implementation of the change-log read port. The write path
 * of every entity repository appends its own record inside the entity
 * transaction; this class owns the queries the history view and the undo flow
 * need, plus the undo stamp used when the inverse write is not itself an entity
 * write.
 *
 * Constraints:
 * - A record is inserted, never replaced: append-only is what makes the log an
 *   audit trail. The undo stamp is the only column that changes afterwards.
 * - `markUndone` reports an unknown identifier instead of silently doing
 *   nothing: the caller decided the record was undoable, so a missing row is a
 *   contract violation.
 */

import type { ChangeRecord } from '../../../domain/changes/ChangeRecord'
import type { ChangeLogRepository } from '../../../domain/changes/ports/ChangeLogRepository'
import type { ChangeRecordId } from '../../../domain/shared/branded-id'
import type { DateTime } from '../../../domain/shared/DateTime'
import type { SqlDatabase } from '../sqlite'
import {
  CHANGE_RECORD_COLUMNS,
  changeRecordRowValues,
  mapChangeRecordRow,
} from './mappers/ChangeRecordRowMapper'
import type { Row } from './mappers/rowContract'

const RECENT_ORDER = 'ORDER BY created_at DESC, id DESC'

export class SqliteChangeRecordRepository implements ChangeLogRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async findById(id: ChangeRecordId): Promise<ChangeRecord | null> {
    const rows = await this.#database.select<Row>(
      `SELECT ${CHANGE_RECORD_COLUMNS} FROM change_record WHERE id = $1`,
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : mapChangeRecordRow(row)
  }

  async latestLiveForEntity(entity: string, entityId: string): Promise<ChangeRecord | null> {
    const rows = await this.#database.select<Row>(
      `SELECT ${CHANGE_RECORD_COLUMNS} FROM change_record ` +
        `WHERE entity = $1 AND entity_id = $2 AND undone_at IS NULL ${RECENT_ORDER} LIMIT 1`,
      [entity, entityId],
    )
    const row = rows[0]
    return row === undefined ? null : mapChangeRecordRow(row)
  }

  async listRecent(limit: number): Promise<readonly ChangeRecord[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`A concrete recent-change limit is required, received ${String(limit)}.`)
    }
    const rows = await this.#database.select<Row>(
      `SELECT ${CHANGE_RECORD_COLUMNS} FROM change_record ${RECENT_ORDER} LIMIT $1`,
      [limit],
    )
    return rows.map(mapChangeRecordRow)
  }

  async append(record: ChangeRecord): Promise<void> {
    await this.#database.execute(
      `INSERT INTO change_record (${CHANGE_RECORD_COLUMNS}) ` +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      changeRecordRowValues(record),
    )
  }

  async markUndone(id: ChangeRecordId, undoneAt: DateTime): Promise<void> {
    const result = await this.#database.execute(
      'UPDATE change_record SET undone_at = $1 WHERE id = $2',
      [undoneAt, id],
    )
    if (result.rowsAffected !== 1) {
      throw new Error(`The change record "${id}" disappeared before it could be marked undone.`)
    }
  }
}
