/**
 * @file AgentEvent
 * @description The streaming event envelope a run emits. The chat interface
 * renders from these events; persisted state is authoritative, so after `done`
 * the interface re-reads the message list unconditionally.
 *
 * Responsibilities:
 * - Declare every event a run can emit, in the order the run emits them
 * - Keep the envelope flat so a store can reduce it without parsing payloads
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - Adding an event member is additive; changing a member's fields is a
 *   contract change for the chat interface.
 */

import type {
  AgentRunId,
  ChangeRecordId,
  ConversationId,
  MessageId,
  ResumeId,
  RevisionId,
  ToolInvocationId,
} from '../shared/branded-id'
import type { ToolRisk } from './ToolRisk'

export type AgentEvent =
  | {
      readonly type: 'runStarted'
      readonly runId: AgentRunId
      readonly conversationId: ConversationId
      readonly userMessageId: MessageId
      readonly assistantMessageId: MessageId
    }
  | { readonly type: 'textDelta'; readonly messageId: MessageId; readonly delta: string }
  | { readonly type: 'turnStarted'; readonly turn: number }
  | {
      readonly type: 'toolStart'
      readonly invocationId: ToolInvocationId
      readonly toolName: string
      readonly risk: ToolRisk
      readonly label: string
      /** Redacted, trimmed argument text, at most 400 characters. */
      readonly argsSummary: string
      readonly messageId: MessageId
    }
  | {
      readonly type: 'toolEnd'
      readonly invocationId: ToolInvocationId
      readonly status: 'ok' | 'failed'
      readonly summary: string
      readonly messageId: MessageId
      readonly changeIds: readonly ChangeRecordId[]
      readonly revisionId: RevisionId | null
      readonly resumeId: ResumeId | null
    }
  | {
      readonly type: 'changeRecorded'
      readonly changeIds: readonly ChangeRecordId[]
      readonly revisionId: RevisionId | null
      readonly resumeId: ResumeId | null
    }
  | { readonly type: 'usage'; readonly promptTokens: number; readonly completionTokens: number }
  | { readonly type: 'error'; readonly message: string; readonly retryable: boolean }
  | {
      readonly type: 'done'
      readonly status: 'completed' | 'cancelled' | 'failed'
      readonly runId: AgentRunId
      readonly errorText: string | null
    }
