/**
 * @file ToolInvocationRepository
 * @description Persistence port for the tool-call audit trail of a run.
 *
 * Constraints:
 * - `record` is an upsert keyed by the invocation id: a call is recorded once
 *   when it starts (for the audit trail) and once when it finishes, and the
 *   second write must replace the first rather than duplicate it.
 */

import type { ToolInvocation } from '../ToolInvocation'
import type { AgentRunId } from '../../shared/branded-id'

export interface ToolInvocationRepository {
  record(invocation: ToolInvocation): Promise<void>
  listByRun(runId: AgentRunId): Promise<readonly ToolInvocation[]>
}
