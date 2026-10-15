/**
 * @file SqliteAgentRunRepository
 * @description SQLite persistence for agent runs and the tool invocations they
 * executed. Runs are inserted once and then updated in place: v1 deletes
 * neither a run nor its audit chain, because variant and revision rows point
 * back at them with ON DELETE RESTRICT.
 *
 * Constraints:
 * - The port defines run persistence only. The tool invocation write path is
 *   declared here as well because tool_invocation.run_id owns those rows for
 *   provenance, and a record with no writer would be written by nobody.
 * - An invocation row is keyed by its own id, so a re-recorded call for the
 *   same id replaces it rather than duplicating the audit entry.
 */

import type { AgentRun } from '../../domain/generation/AgentRun'
import type { ToolInvocation } from '../../domain/generation/ToolInvocation'
import type { AgentRunRepository } from '../../domain/generation/ports/AgentRunRepository'
import type { AgentRunId } from '../../domain/shared/branded-id'
import {
  fromAgentRunRow,
  fromToolInvocationRow,
  toAgentRunRow,
  toToolInvocationRow,
} from './mappers/AgentRunRowMapper'
import type { AgentRunRow, ToolInvocationRow } from './mappers/AgentRunRowMapper'
import type { SqlDatabase } from './sqlite'

export class SqliteAgentRunRepository implements AgentRunRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async create(run: AgentRun): Promise<void> {
    const row = toAgentRunRow(run)
    await this.#database.execute(
      `INSERT INTO agent_run (id, resume_id, job_posting_id, status, error_text, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, row.resume_id, row.job_posting_id, row.status, row.error_text, row.started_at, row.ended_at],
    )
  }

  async save(run: AgentRun): Promise<void> {
    const row = toAgentRunRow(run)
    await this.#database.execute(
      `UPDATE agent_run
       SET resume_id = $1, job_posting_id = $2, status = $3, error_text = $4, started_at = $5, ended_at = $6
       WHERE id = $7`,
      [row.resume_id, row.job_posting_id, row.status, row.error_text, row.started_at, row.ended_at, row.id],
    )
  }

  async findById(id: AgentRunId): Promise<AgentRun | null> {
    const rows = await this.#database.select<AgentRunRow>('SELECT * FROM agent_run WHERE id = $1', [id])
    const row = rows[0]
    return row === undefined ? null : fromAgentRunRow(row)
  }

  /** Writes the audit entry for one tool call. */
  async recordToolInvocation(invocation: ToolInvocation): Promise<void> {
    const row = toToolInvocationRow(invocation)
    await this.#database.execute(
      `INSERT INTO tool_invocation (id, run_id, tool_name, risk, args_json, result_json, approval_state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         run_id = excluded.run_id,
         tool_name = excluded.tool_name,
         risk = excluded.risk,
         args_json = excluded.args_json,
         result_json = excluded.result_json,
         approval_state = excluded.approval_state,
         created_at = excluded.created_at`,
      [
        row.id,
        row.run_id,
        row.tool_name,
        row.risk,
        row.args_json,
        row.result_json,
        row.approval_state,
        row.created_at,
      ],
    )
  }

  /** Oldest first: an audit chain is read in the order it happened. */
  async listToolInvocations(runId: AgentRunId): Promise<readonly ToolInvocation[]> {
    const rows = await this.#database.select<ToolInvocationRow>(
      'SELECT * FROM tool_invocation WHERE run_id = $1 ORDER BY created_at ASC, id ASC',
      [runId],
    )
    return rows.map(fromToolInvocationRow)
  }
}
