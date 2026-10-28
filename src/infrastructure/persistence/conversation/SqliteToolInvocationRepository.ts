/**
 * @file SqliteToolInvocationRepository
 * @description SQLite persistence for the tool-call audit trail. The record call
 * is an upsert because a call is recorded when it starts and again when it ends;
 * the second write must replace the first.
 */

import type { AgentRunId } from '../../../domain/shared/branded-id'
import type { ToolInvocation } from '../../../domain/generation/ToolInvocation'
import type { ToolInvocationRepository } from '../../../domain/generation/ports/ToolInvocationRepository'
import type { SqlDatabase } from '../sqlite'
import { fromToolInvocationRow, toToolInvocationRow } from './mappers/AgentRunRowMapper'
import type { ToolInvocationRow } from './mappers/AgentRunRowMapper'

const COLUMNS =
  'id, run_id, message_id, tool_name, risk, args_json, result_summary_json, change_ids_json, revision_id, status, created_at'

export class SqliteToolInvocationRepository implements ToolInvocationRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async record(invocation: ToolInvocation): Promise<void> {
    const row = toToolInvocationRow(invocation)
    await this.#database.execute(
      `INSERT INTO tool_invocation (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         message_id = excluded.message_id,
         tool_name = excluded.tool_name,
         risk = excluded.risk,
         args_json = excluded.args_json,
         result_summary_json = excluded.result_summary_json,
         change_ids_json = excluded.change_ids_json,
         revision_id = excluded.revision_id,
         status = excluded.status`,
      [
        row.id,
        row.run_id,
        row.message_id,
        row.tool_name,
        row.risk,
        row.args_json,
        row.result_summary_json,
        row.change_ids_json,
        row.revision_id,
        row.status,
        row.created_at,
      ],
    )
  }

  async listByRun(runId: AgentRunId): Promise<readonly ToolInvocation[]> {
    const rows = await this.#database.select<ToolInvocationRow>(
      `SELECT ${COLUMNS} FROM tool_invocation WHERE run_id = $1 ORDER BY created_at ASC, id ASC`,
      [runId],
    )
    return rows.map(fromToolInvocationRow)
  }
}
