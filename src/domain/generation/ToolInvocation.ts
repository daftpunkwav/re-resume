/**
 * @file ToolInvocation
 * @description The audit row for one tool call the run loop executed. The row
 * outlives the message card it belongs to; `messageId` is cleared when the
 * conversation is deleted while the invocation itself stays with its run.
 *
 * Constraints:
 * - `argsJson` and `resultSummaryJson` are stored already redacted; a secret
 *   that reached a tool argument never reaches this table.
 */

import type { DateTime } from '../shared/DateTime'
import type {
  AgentRunId,
  ChangeRecordId,
  MessageId,
  RevisionId,
  ToolInvocationId,
} from '../shared/branded-id'
import type { ToolRisk } from './ToolRisk'

export const TOOL_INVOCATION_STATUSES = ['ok', 'failed'] as const

export type ToolInvocationStatus = (typeof TOOL_INVOCATION_STATUSES)[number]

export interface ToolInvocation {
  readonly id: ToolInvocationId
  readonly runId: AgentRunId
  readonly messageId: MessageId | null
  readonly toolName: string
  readonly risk: ToolRisk
  /** Redacted arguments as the model sent them. */
  readonly argsJson: string
  /** Redacted, truncated summary of what the tool returned. */
  readonly resultSummaryJson: string | null
  readonly changeIds: readonly ChangeRecordId[]
  readonly revisionId: RevisionId | null
  readonly status: ToolInvocationStatus
  readonly createdAt: DateTime
}

export function isToolInvocationStatus(value: unknown): value is ToolInvocationStatus {
  return typeof value === 'string' && (TOOL_INVOCATION_STATUSES as readonly string[]).includes(value)
}
