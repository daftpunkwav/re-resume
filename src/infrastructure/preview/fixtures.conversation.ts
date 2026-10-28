/**
 * @file fixtures.conversation
 * @description Starting data for the conversation area of the browser preview:
 * one conversation with a user turn, an assistant answer and a tool card, the
 * completed run they belong to, and the script the preview model replays.
 *
 * Constraints:
 * - Preview assembly only. Every value is plain data; the preview root builds
 *   its own repositories around it.
 * - Identifiers and timestamps are fixed, so a preview session and a screenshot
 *   test see the same stream on every run.
 */

import type { AgentRun } from '../../domain/generation/AgentRun'
import type { Conversation } from '../../domain/conversation/Conversation'
import type { Message } from '../../domain/conversation/Message'
import type { ModelChunk } from '../../domain/generation/ports/ModelProvider'
import type { ToolInvocation } from '../../domain/generation/ToolInvocation'
import type { DateTime } from '../../domain/shared/DateTime'
import { parseDateTime } from '../../domain/shared/DateTime'
import {
  asAgentRunId,
  asConversationId,
  asMessageId,
  asToolInvocationId,
} from '../../domain/shared/branded-id'

const EPOCH: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

function at(second: number): DateTime {
  return parseDateTime(`2026-01-01T00:00:${String(second).padStart(2, '0')}.000Z`) as DateTime
}

export const PREVIEW_CONVERSATION_ID = asConversationId('conversation-preview')
export const PREVIEW_RUN_ID = asAgentRunId('run-preview')
const USER_MESSAGE_ID = asMessageId('message-preview-user')
const ASSISTANT_MESSAGE_ID = asMessageId('message-preview-assistant')
const TOOL_MESSAGE_ID = asMessageId('message-preview-tool')
const TOOL_INVOCATION_ID = asToolInvocationId('invocation-preview')

export const PREVIEW_CONVERSATION: Conversation = {
  id: PREVIEW_CONVERSATION_ID,
  title: '为字节跳动前端岗位准备简历',
  providerId: null,
  modelId: null,
  pinned: false,
  activeResumeId: null,
  summary: null,
  summaryThroughSeq: null,
  createdAt: EPOCH,
  updatedAt: at(4),
}

export const PREVIEW_RUN: AgentRun = {
  id: PREVIEW_RUN_ID,
  conversationId: PREVIEW_CONVERSATION_ID,
  resumeId: null,
  jobPostingId: null,
  status: 'completed',
  errorText: null,
  promptTokens: 120,
  completionTokens: 86,
  startedAt: at(1),
  endedAt: at(4),
}

export const PREVIEW_TOOL_INVOCATION: ToolInvocation = {
  id: TOOL_INVOCATION_ID,
  runId: PREVIEW_RUN_ID,
  messageId: TOOL_MESSAGE_ID,
  toolName: 'searchInfoEntries',
  risk: 'read',
  argsJson: '{"keyword":"前端","limit":10}',
  resultSummaryJson: '{"ok":true,"value":{"hits":3}}',
  changeIds: [],
  revisionId: null,
  status: 'ok',
  createdAt: at(2),
}

export const PREVIEW_MESSAGES: readonly Message[] = [
  {
    id: USER_MESSAGE_ID,
    conversationId: PREVIEW_CONVERSATION_ID,
    seq: 1,
    kind: 'user',
    status: 'complete',
    markdown: '帮我针对字节跳动的前端岗位整理一份简历，重点突出项目经历。',
    attachmentIds: [],
    tool: null,
    runId: null,
    errorText: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  },
  {
    id: TOOL_MESSAGE_ID,
    conversationId: PREVIEW_CONVERSATION_ID,
    seq: 2,
    kind: 'tool',
    status: 'complete',
    markdown: '',
    attachmentIds: [],
    tool: {
      toolName: 'searchInfoEntries',
      invocationId: TOOL_INVOCATION_ID,
      risk: 'read',
      label: '检索信息条目',
      detail: '命中 3 条项目经历：订单中台、增长实验平台、数据看板。',
      changeIds: [],
      revisionId: null,
      resumeId: null,
    },
    runId: PREVIEW_RUN_ID,
    errorText: null,
    createdAt: at(2),
    updatedAt: at(2),
  },
  {
    id: ASSISTANT_MESSAGE_ID,
    conversationId: PREVIEW_CONVERSATION_ID,
    seq: 3,
    kind: 'assistant',
    status: 'complete',
    markdown:
      '我从信息库里挑出了与前端岗位最相关的三条项目经历：订单中台、增长实验平台和数据看板。' +
      '它们的共同点是都包含组件化与性能优化的工作。需要我把这三条写进一份新简历吗？',
    attachmentIds: [],
    tool: null,
    runId: PREVIEW_RUN_ID,
    errorText: null,
    createdAt: at(3),
    updatedAt: at(4),
  },
]

/** Replayed for each new preview turn; deterministic Chinese text. */
export const PREVIEW_CONVERSATION_SCRIPT: readonly ModelChunk[] = [
  { type: 'text', textDelta: '好的。' },
  { type: 'text', textDelta: '我先从信息库里挑选与目标岗位相关的经历，' },
  { type: 'text', textDelta: '再按照岗位要求组装成一份简历。' },
]
