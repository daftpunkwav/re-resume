/**
 * @file ToolInvocation
 * @description Audit record for one agent tool call. Kept even for read-only
 * tools so a run can be explained after the fact.
 */

import type { DateTime } from '../shared/DateTime'
import type { AgentRunId, ToolInvocationId } from '../shared/branded-id'
import type { ToolRisk } from './ToolRisk'

/**
 * read/write/propose calls are created as approved and become executed after
 * the call returns. destructive calls start at pending. v1 registers no
 * destructive tools, so pending is reserved and unreachable by design.
 */
export const APPROVAL_STATES = ['pending', 'approved', 'rejected', 'executed'] as const

export type ApprovalState = (typeof APPROVAL_STATES)[number]

export interface ToolInvocation {
  readonly id: ToolInvocationId
  readonly runId: AgentRunId
  readonly toolName: string
  readonly risk: ToolRisk
  readonly argsJson: string
  readonly resultJson: string | null
  readonly approvalState: ApprovalState
  readonly createdAt: DateTime
}

export function initialApprovalState(risk: ToolRisk): ApprovalState {
  return risk === 'destructive' ? 'pending' : 'approved'
}
