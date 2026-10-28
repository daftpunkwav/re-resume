/**
 * @file SqliteMessageRepository
 * @description SQLite persistence for messages, their attachment links and the
 * per-conversation run gate.
 *
 * Constraints:
 * - A message row and its attachment links are written in one transaction: a
 *   message that names an attachment it has no link row for would render as an
 *   empty chip and could never be repaired.
 * - `createRun` runs in a transaction and lets the partial unique index on
 *   `agent_run` be the final word: two writers that both saw no running row
 *   cannot both insert one, and the loser returns the winner's run.
 */

import type { AgentRun } from '../../../domain/generation/AgentRun'
import type { Message } from '../../../domain/conversation/Message'
import type { MessageRepository } from '../../../domain/conversation/ports/MessageRepository'
import type { ConversationId, MessageId } from '../../../domain/shared/branded-id'
import type { SqlDatabase, SqlValue } from '../sqlite'
import { fromAgentRunRow, toAgentRunRow } from './mappers/AgentRunRowMapper'
import type { AgentRunRow } from './mappers/AgentRunRowMapper'
import { fromMessageRow, toMessageRow } from './mappers/MessageRowMapper'
import type { MessageRow } from './mappers/MessageRowMapper'

const COLUMNS =
  'id, conversation_id, seq, kind, status, markdown, tool_json, run_id, error_text, created_at, updated_at'

export class SqliteMessageRepository implements MessageRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async listByConversation(id: ConversationId, limit: number): Promise<readonly Message[]> {
    if (limit <= 0) return []
    const rows = await this.#database.select<MessageRow>(
      `SELECT ${COLUMNS} FROM (
         SELECT ${COLUMNS} FROM message WHERE conversation_id = $1 ORDER BY seq DESC LIMIT $2
       ) ORDER BY seq ASC`,
      [id, limit],
    )
    return this.#withAttachments(rows)
  }

  async findBySeq(id: ConversationId, seq: number): Promise<Message | null> {
    const rows = await this.#database.select<MessageRow>(
      `SELECT ${COLUMNS} FROM message WHERE conversation_id = $1 AND seq = $2`,
      [id, seq],
    )
    const messages = await this.#withAttachments(rows)
    return messages[0] ?? null
  }

  async findById(id: MessageId): Promise<Message | null> {
    const rows = await this.#database.select<MessageRow>(
      `SELECT ${COLUMNS} FROM message WHERE id = $1`,
      [id],
    )
    const messages = await this.#withAttachments(rows)
    return messages[0] ?? null
  }

  async nextSeq(id: ConversationId): Promise<number> {
    const rows = await this.#database.select<{ next_seq: number }>(
      'SELECT IFNULL(MAX(seq), 0) + 1 AS next_seq FROM message WHERE conversation_id = $1',
      [id],
    )
    return rows[0]?.next_seq ?? 1
  }

  async insert(message: Message): Promise<void> {
    const row = toMessageRow(message)
    await this.#database.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO message (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          row.id,
          row.conversation_id,
          row.seq,
          row.kind,
          row.status,
          row.markdown,
          row.tool_json,
          row.run_id,
          row.error_text,
          row.created_at,
          row.updated_at,
        ],
      )
      for (const [position, attachmentId] of message.attachmentIds.entries()) {
        await tx.execute(
          'INSERT INTO message_attachment (message_id, attachment_id, position) VALUES ($1, $2, $3)',
          [message.id, attachmentId, position],
        )
      }
    })
  }

  async update(message: Message): Promise<void> {
    const row = toMessageRow(message)
    await this.#database.execute(
      `UPDATE message SET status = $2, markdown = $3, tool_json = $4, run_id = $5,
         error_text = $6, updated_at = $7
       WHERE id = $1`,
      [row.id, row.status, row.markdown, row.tool_json, row.run_id, row.error_text, row.updated_at],
    )
  }

  async deleteAfter(id: ConversationId, seq: number): Promise<void> {
    await this.#database.execute(
      'DELETE FROM message WHERE conversation_id = $1 AND seq > $2',
      [id, seq],
    )
  }

  async createRun(run: AgentRun): Promise<AgentRun> {
    return this.#database.transaction(async (tx) => {
      const existing = await tx.select<AgentRunRow>(
        'SELECT * FROM agent_run WHERE conversation_id = $1 AND status = $2 LIMIT 1',
        [run.conversationId, 'running'],
      )
      const running = existing[0]
      if (running !== undefined) return fromAgentRunRow(running)
      try {
        await tx.execute(
          `INSERT INTO agent_run (id, conversation_id, resume_id, job_posting_id, status, error_text,
             prompt_tokens, completion_tokens, started_at, ended_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          runValues(run),
        )
        return run
      } catch (failure) {
        // The partial unique index rejected a second running run: another
        // writer won the race between the read above and this insert.
        const winner = await tx.select<AgentRunRow>(
          'SELECT * FROM agent_run WHERE conversation_id = $1 AND status = $2 LIMIT 1',
          [run.conversationId, 'running'],
        )
        const found = winner[0]
        if (found === undefined) throw failure
        return fromAgentRunRow(found)
      }
    })
  }

  /** Loads the attachment links of a page of messages in one statement. */
  async #withAttachments(rows: readonly MessageRow[]): Promise<readonly Message[]> {
    if (rows.length === 0) return []
    const messageIds = rows.map((row) => String(row.id))
    const placeholders = messageIds.map((_, position) => `$${position + 1}`).join(', ')
    const links = await this.#database.select<{ message_id: string; attachment_id: string }>(
      `SELECT message_id, attachment_id FROM message_attachment
       WHERE message_id IN (${placeholders})
       ORDER BY message_id ASC, position ASC`,
      messageIds,
    )
    const byMessage = new Map<string, string[]>()
    for (const link of links) {
      const ids = byMessage.get(link.message_id) ?? []
      ids.push(link.attachment_id)
      byMessage.set(link.message_id, ids)
    }
    return rows.map((row) => fromMessageRow(row, byMessage.get(String(row.id)) ?? []))
  }
}

function runValues(run: AgentRun): readonly SqlValue[] {
  const row = toAgentRunRow(run)
  return [
    row.id,
    row.conversation_id,
    row.resume_id,
    row.job_posting_id,
    row.status,
    row.error_text,
    row.prompt_tokens,
    row.completion_tokens,
    row.started_at,
    row.ended_at,
  ]
}
