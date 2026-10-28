/**
 * @file SqliteAgentRunRepository
 * @description SQLite persistence for agent runs. The query the startup
 * recovery needs — every run a previous process left running — is part of the
 * port because a repository method is the only legal way for the application
 * layer to ask.
 */

import type { AgentRun } from '../../../domain/generation/AgentRun'
import type { AgentRunRepository } from '../../../domain/generation/ports/AgentRunRepository'
import type { AgentRunId, ConversationId } from '../../../domain/shared/branded-id'
import type { SqlDatabase } from '../sqlite'
import { fromAgentRunRow, toAgentRunRow } from './mappers/AgentRunRowMapper'
import type { AgentRunRow } from './mappers/AgentRunRowMapper'

const COLUMNS =
  'id, conversation_id, resume_id, job_posting_id, status, error_text, prompt_tokens, completion_tokens, started_at, ended_at'

export class SqliteAgentRunRepository implements AgentRunRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async create(run: AgentRun): Promise<void> {
    const row = toAgentRunRow(run)
    await this.#database.execute(
      `INSERT INTO agent_run (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
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
      ],
    )
  }

  async save(run: AgentRun): Promise<void> {
    const row = toAgentRunRow(run)
    await this.#database.execute(
      `UPDATE agent_run SET conversation_id = $2, resume_id = $3, job_posting_id = $4, status = $5,
         error_text = $6, prompt_tokens = $7, completion_tokens = $8, started_at = $9, ended_at = $10
       WHERE id = $1`,
      [
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
      ],
    )
  }

  async findById(id: AgentRunId): Promise<AgentRun | null> {
    const rows = await this.#database.select<AgentRunRow>(
      `SELECT ${COLUMNS} FROM agent_run WHERE id = $1`,
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : fromAgentRunRow(row)
  }

  async findRunningByConversation(id: ConversationId): Promise<AgentRun | null> {
    const rows = await this.#database.select<AgentRunRow>(
      `SELECT ${COLUMNS} FROM agent_run WHERE conversation_id = $1 AND status = 'running' LIMIT 1`,
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : fromAgentRunRow(row)
  }

  async listRunning(): Promise<readonly AgentRun[]> {
    const rows = await this.#database.select<AgentRunRow>(
      `SELECT ${COLUMNS} FROM agent_run WHERE status = 'running' ORDER BY started_at ASC, id ASC`,
    )
    return rows.map(fromAgentRunRow)
  }
}
