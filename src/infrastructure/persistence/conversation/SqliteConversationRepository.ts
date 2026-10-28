/**
 * @file SqliteConversationRepository
 * @description SQLite persistence for conversation rows. Titles, pin flags and
 * the rolling summary live here; the transcript lives in the message table and
 * is removed by the foreign key when the conversation is deleted.
 */

import type { Conversation } from '../../../domain/conversation/Conversation'
import type { ConversationRepository } from '../../../domain/conversation/ports/ConversationRepository'
import type { ConversationId } from '../../../domain/shared/branded-id'
import type { SqlDatabase } from '../sqlite'
import { fromConversationRow, toConversationRow } from './mappers/ConversationRowMapper'
import type { ConversationRow } from './mappers/ConversationRowMapper'

const COLUMNS =
  'id, title, provider_id, model_id, pinned, active_resume_id, summary, summary_through_seq, created_at, updated_at'

export class SqliteConversationRepository implements ConversationRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async findById(id: ConversationId): Promise<Conversation | null> {
    const rows = await this.#database.select<ConversationRow>(
      `SELECT ${COLUMNS} FROM conversation WHERE id = $1`,
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : fromConversationRow(row)
  }

  async listAll(): Promise<readonly Conversation[]> {
    const rows = await this.#database.select<ConversationRow>(
      `SELECT ${COLUMNS} FROM conversation ORDER BY pinned DESC, updated_at DESC, id ASC`,
    )
    return rows.map(fromConversationRow)
  }

  async insert(conversation: Conversation): Promise<void> {
    const row = toConversationRow(conversation)
    await this.#database.execute(
      `INSERT INTO conversation (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.id,
        row.title,
        row.provider_id,
        row.model_id,
        row.pinned,
        row.active_resume_id,
        row.summary,
        row.summary_through_seq,
        row.created_at,
        row.updated_at,
      ],
    )
  }

  async update(conversation: Conversation): Promise<void> {
    const row = toConversationRow(conversation)
    await this.#database.execute(
      `UPDATE conversation SET title = $2, provider_id = $3, model_id = $4, pinned = $5,
         active_resume_id = $6, summary = $7, summary_through_seq = $8, updated_at = $9
       WHERE id = $1`,
      [
        row.id,
        row.title,
        row.provider_id,
        row.model_id,
        row.pinned,
        row.active_resume_id,
        row.summary,
        row.summary_through_seq,
        row.updated_at,
      ],
    )
  }

  async delete(id: ConversationId): Promise<void> {
    await this.#database.execute('DELETE FROM conversation WHERE id = $1', [id])
  }
}
