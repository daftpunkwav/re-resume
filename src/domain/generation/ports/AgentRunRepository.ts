/**
 * @file AgentRunRepository
 * @description Persistence port for agent runs. Runs are never deleted: they
 * anchor the change records and tool invocations a turn produced.
 *
 * Constraints:
 * - `create` refuses a second running run for the same conversation. The
 *   database enforces this with the partial unique index `idx_run_one_running`;
 *   a run without a conversation (a standalone job-posting parse) does not
 *   participate because SQLite treats its NULL as distinct.
 * - `listRunning` exists for crash recovery only: on startup the application
 *   fails runs a previous process left running, so the interface never shows a
 *   permanent "generating" state.
 */

import type { AgentRun } from '../AgentRun'
import type { AgentRunId, ConversationId } from '../../shared/branded-id'

export interface AgentRunRepository {
  create(run: AgentRun): Promise<void>
  save(run: AgentRun): Promise<void>
  findById(id: AgentRunId): Promise<AgentRun | null>
  findRunningByConversation(id: ConversationId): Promise<AgentRun | null>
  listRunning(): Promise<readonly AgentRun[]>
}
