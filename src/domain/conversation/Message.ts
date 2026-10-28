/**
 * @file Message
 * @description One entry of a conversation: a user turn, the assistant's
 * visible answer, or the audit card of a tool the assistant ran.
 *
 * Responsibilities:
 * - Declare the message shape and the tool card payload
 * - Own the message status machine: which kind may start in which status and
 *   which transitions are legal
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - A message never changes its kind. Only the status moves, and only along the
 *   transitions below; the persistence CHECK constraints mirror them.
 */

import { DomainError } from '../shared/DomainError'
import type { DateTime } from '../shared/DateTime'
import type {
  AgentRunId,
  AttachmentId,
  ChangeRecordId,
  ConversationId,
  MessageId,
  ResumeId,
  RevisionId,
  ToolInvocationId,
} from '../shared/branded-id'
import type { ToolRisk } from '../generation/ToolRisk'

export const MESSAGE_KINDS = ['user', 'assistant', 'tool'] as const

export type MessageKind = (typeof MESSAGE_KINDS)[number]

export const MESSAGE_STATUSES = ['streaming', 'complete', 'cancelled', 'failed', 'running'] as const

export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

/** Longest folded detail a tool card shows, in characters. */
export const TOOL_DETAIL_MAX_LENGTH = 2000

/** What a tool message records about the call it represents. */
export interface ToolMessagePayload {
  readonly toolName: string
  /** null when the model named a tool this build does not register. */
  readonly invocationId: ToolInvocationId | null
  readonly risk: ToolRisk
  /** Chinese card label, for example 「检索项目经历」. */
  readonly label: string
  /** Collapsed, already-redacted summary of the call and its outcome. */
  readonly detail: string
  readonly changeIds: readonly ChangeRecordId[]
  readonly revisionId: RevisionId | null
  readonly resumeId: ResumeId | null
}

export interface Message {
  readonly id: MessageId
  readonly conversationId: ConversationId
  /** 1..n within the conversation, monotonically increasing. */
  readonly seq: number
  readonly kind: MessageKind
  readonly status: MessageStatus
  /** Empty for tool messages. */
  readonly markdown: string
  readonly attachmentIds: readonly AttachmentId[]
  readonly tool: ToolMessagePayload | null
  readonly runId: AgentRunId | null
  readonly errorText: string | null
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

/**
 * The status a message starts in. A user turn is written as already complete;
 * the assistant answer starts streaming; a tool card starts running.
 */
export function initialMessageStatus(kind: MessageKind): MessageStatus {
  switch (kind) {
    case 'user':
      return 'complete'
    case 'assistant':
      return 'streaming'
    case 'tool':
      return 'running'
  }
}

const ALLOWED_TRANSITIONS: Readonly<Record<MessageKind, Readonly<Record<MessageStatus, readonly MessageStatus[]>>>> = {
  // A user turn is written once and never edited.
  user: { streaming: [], complete: [], cancelled: [], failed: [], running: [] },
  assistant: {
    streaming: ['complete', 'cancelled', 'failed'],
    complete: [],
    cancelled: [],
    failed: [],
    running: [],
  },
  tool: {
    running: ['complete', 'failed'],
    streaming: [],
    complete: [],
    cancelled: [],
    failed: [],
  },
}

/**
 * Rejects a status change the state machine does not allow. A no-op update is
 * accepted: the streamed text is persisted repeatedly while the status stays
 * `streaming`.
 */
export function assertMessageStatusChange(
  kind: MessageKind,
  from: MessageStatus,
  to: MessageStatus,
): void {
  if (from === to) return
  if (ALLOWED_TRANSITIONS[kind][from].includes(to)) return
  throw new DomainError(
    'invalidFieldValue',
    `消息状态不能从 ${from} 变为 ${to}（kind=${kind}）。`,
  )
}

/** A tool card carries a payload exactly when the message kind is tool. */
export function assertToolPayloadMatchesKind(
  kind: MessageKind,
  tool: ToolMessagePayload | null,
): void {
  if (kind === 'tool' && tool === null) {
    throw new DomainError('invalidFieldValue', '工具消息必须携带工具摘要。')
  }
  if (kind !== 'tool' && tool !== null) {
    throw new DomainError('invalidFieldValue', '只有工具消息可以携带工具摘要。')
  }
}

export function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === 'string' && (MESSAGE_KINDS as readonly string[]).includes(value)
}

export function isMessageStatus(value: unknown): value is MessageStatus {
  return typeof value === 'string' && (MESSAGE_STATUSES as readonly string[]).includes(value)
}

/** Truncates a tool detail to the card limit, keeping the head of the message. */
export function truncateToolDetail(detail: string): string {
  const codePoints = [...detail]
  if (codePoints.length <= TOOL_DETAIL_MAX_LENGTH) return detail
  return `${codePoints.slice(0, TOOL_DETAIL_MAX_LENGTH - 1).join('')}…`
}
