/**
 * @file fixtures.conversation
 * @description Starting data for the conversation area of the browser preview:
 * three sessions across the sidebar groups, each with the transcript it stored,
 * the completed runs they belong to, the recorded write one tool card can undo,
 * and the scripts the preview model replays.
 *
 * Constraints:
 * - Preview assembly only. Every value is plain data; the preview root builds
 *   its own repositories around it.
 * - Identifiers and timestamps are fixed, so a preview session and a screenshot
 *   test see the same stream on every run.
 * - The conversation that starts the preview is the most recently updated one,
 *   which is also the one the scripts and the tool cards describe.
 */

import type { AgentRun } from '../../domain/generation/AgentRun'
import type { ChangeRecord } from '../../domain/changes/ChangeRecord'
import type { Conversation } from '../../domain/conversation/Conversation'
import type { Message } from '../../domain/conversation/Message'
import type { MessageContext } from '../../domain/conversation/MessageContext'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import type { ModelChunk } from '../../domain/generation/ports/ModelProvider'
import type { ToolInvocation } from '../../domain/generation/ToolInvocation'
import type { DateTime } from '../../domain/shared/DateTime'
import { parseDateTime } from '../../domain/shared/DateTime'
import {
  asAgentRunId,
  asChangeRecordId,
  asConversationId,
  asInfoEntryId,
  asMessageId,
  asToolInvocationId,
} from '../../domain/shared/branded-id'
import { PREVIEW_INFO_ENTRIES } from './fixtures.info'

const EPOCH: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const DAY = 86_400_000

function daysBefore(epoch: DateTime, days: number, second = 0): DateTime {
  return parseDateTime(
    new Date(Date.parse(epoch) - days * DAY + second * 1000).toISOString(),
  ) as DateTime
}

function at(second: number): DateTime {
  return parseDateTime(`2026-01-01T00:00:${String(second).padStart(2, '0')}.000Z`) as DateTime
}

export const PREVIEW_CONVERSATION_ID = asConversationId('conversation-preview')
export const PREVIEW_RUN_ID = asAgentRunId('run-preview')
export const PREVIEW_USER_MESSAGE_ID = asMessageId('message-preview-user')
const ASSISTANT_MESSAGE_ID = asMessageId('message-preview-assistant')
const READ_TOOL_MESSAGE_ID = asMessageId('message-preview-tool')
const WRITE_TOOL_MESSAGE_ID = asMessageId('message-preview-tool-write')
const TOOL_INVOCATION_ID = asToolInvocationId('invocation-preview')
const WRITE_TOOL_INVOCATION_ID = asToolInvocationId('invocation-preview-write')
export const PREVIEW_CHANGE_ID = asChangeRecordId('change-preview-project-update')

/** Pinned session shown under the pinned group; written in the last seven days. */
export const PREVIEW_PINNED_CONVERSATION_ID = asConversationId('conversation-pinned')
const PINNED_USER_MESSAGE_ID = asMessageId('message-pinned-user')
const PINNED_ASSISTANT_MESSAGE_ID = asMessageId('message-pinned-assistant')

/** Older session, shown under "earlier". */
export const PREVIEW_OLDER_CONVERSATION_ID = asConversationId('conversation-older')

export const PREVIEW_CONVERSATIONS: readonly Conversation[] = [
  {
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
  },
  {
    id: PREVIEW_PINNED_CONVERSATION_ID,
    title: '梳理我的实习经历',
    providerId: null,
    modelId: null,
    pinned: true,
    activeResumeId: null,
    summary: null,
    summaryThroughSeq: null,
    createdAt: daysBefore(EPOCH, 2),
    updatedAt: daysBefore(EPOCH, 2, 30),
  },
  {
    id: PREVIEW_OLDER_CONVERSATION_ID,
    title: '第一次使用助手',
    providerId: null,
    modelId: null,
    pinned: false,
    activeResumeId: null,
    summary: null,
    summaryThroughSeq: null,
    createdAt: daysBefore(EPOCH, 45),
    updatedAt: daysBefore(EPOCH, 44, 10),
  },
]

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
  messageId: READ_TOOL_MESSAGE_ID,
  toolName: 'searchInfoEntries',
  risk: 'read',
  argsJson: '{"keyword":"前端","limit":10}',
  resultSummaryJson: '{"ok":true,"value":{"hits":3}}',
  changeIds: [],
  revisionId: null,
  status: 'ok',
  createdAt: at(2),
}

const PROJECT_ENTRY: InfoEntry = PREVIEW_INFO_ENTRIES.find(
  (entry) => entry.id === 'preview-project-1',
) as InfoEntry

/**
 * The state the assistant rewrote: the same project with its earlier description.
 * The undo button on the write card restores this value in the preview.
 */
const PROJECT_ENTRY_BEFORE: InfoEntry = {
  ...PROJECT_ENTRY,
  fields: {
    ...PROJECT_ENTRY.fields,
    description: '负责订单服务日常维护与接口开发。',
  },
  updatedAt: daysBefore(EPOCH, 1),
}

export const PREVIEW_CHANGE_RECORD: ChangeRecord = {
  id: PREVIEW_CHANGE_ID,
  scope: 'library',
  entity: 'infoEntry',
  entityId: PROJECT_ENTRY.id,
  op: 'infoEntry.update',
  beforeJson: JSON.stringify(PROJECT_ENTRY_BEFORE),
  afterJson: JSON.stringify(PROJECT_ENTRY),
  origin: 'agent',
  runId: PREVIEW_RUN_ID,
  conversationId: PREVIEW_CONVERSATION_ID,
  label: '更新项目经历：订单中台重构',
  undoneAt: null,
  createdAt: at(2),
}

export const PREVIEW_WRITE_TOOL_INVOCATION: ToolInvocation = {
  id: WRITE_TOOL_INVOCATION_ID,
  runId: PREVIEW_RUN_ID,
  messageId: WRITE_TOOL_MESSAGE_ID,
  toolName: 'updateInfoEntry',
  risk: 'write',
  argsJson: '{"entryId":"preview-project-1","fields":{"description":"面向后端岗位的项目描述"}}',
  resultSummaryJson: JSON.stringify({ ok: true, value: { entryId: PROJECT_ENTRY.id } }),
  changeIds: [PREVIEW_CHANGE_ID],
  revisionId: null,
  status: 'ok',
  createdAt: at(2),
}

export const PREVIEW_MESSAGES: readonly Message[] = [
  {
    id: PREVIEW_USER_MESSAGE_ID,
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
    id: READ_TOOL_MESSAGE_ID,
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
      detail: '命中 3 条项目经历：订单中台重构、校园二手交易平台、数据看板。',
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
    id: WRITE_TOOL_MESSAGE_ID,
    conversationId: PREVIEW_CONVERSATION_ID,
    seq: 3,
    kind: 'tool',
    status: 'complete',
    markdown: '',
    attachmentIds: [],
    tool: {
      toolName: 'updateInfoEntry',
      invocationId: WRITE_TOOL_INVOCATION_ID,
      risk: 'write',
      label: '更新项目经历',
      detail: '已把「订单中台重构」的描述改写为面向后端岗位的版本，原始内容仍可撤销。',
      changeIds: [PREVIEW_CHANGE_ID],
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
    seq: 4,
    kind: 'assistant',
    status: 'complete',
    markdown:
      '我从信息库里挑出了与前端岗位最相关的三条项目经历，并把「订单中台重构」的描述改成了更贴近岗位要求的写法。\n\n' +
      '- **订单中台重构**：组件化拆分与结算链路性能优化\n' +
      '- **校园二手交易平台**：从 0 到 1 的完整前端实现\n' +
      '- **数据看板**：复杂表格与图表的交互细节\n\n' +
      '需要我把这三条写进一份新简历吗？',
    attachmentIds: [],
    tool: null,
    runId: PREVIEW_RUN_ID,
    errorText: null,
    createdAt: at(3),
    updatedAt: at(4),
  },
  {
    id: PINNED_USER_MESSAGE_ID,
    conversationId: PREVIEW_PINNED_CONVERSATION_ID,
    seq: 1,
    kind: 'user',
    status: 'complete',
    markdown: '帮我把两段实习经历按时间顺序整理一下。',
    attachmentIds: [],
    tool: null,
    runId: null,
    errorText: null,
    createdAt: daysBefore(EPOCH, 2, 20),
    updatedAt: daysBefore(EPOCH, 2, 20),
  },
  {
    id: PINNED_ASSISTANT_MESSAGE_ID,
    conversationId: PREVIEW_PINNED_CONVERSATION_ID,
    seq: 2,
    kind: 'assistant',
    status: 'complete',
    markdown:
      '已经按时间倒序列出两段实习：**电商中台**（2024）在前，**创业公司全栈实习**（2023）在后。' +
      '两段都补充了可量化的成果，方便后续直接引用。',
    attachmentIds: [],
    tool: null,
    runId: null,
    errorText: null,
    createdAt: daysBefore(EPOCH, 2, 28),
    updatedAt: daysBefore(EPOCH, 2, 30),
  },
]

/** Chips attached to the opening user turn, shown on the bubble after a reload. */
export const PREVIEW_MESSAGE_CONTEXTS: readonly {
  readonly messageId: Message['id']
  readonly context: MessageContext
}[] = [
  {
    messageId: PREVIEW_USER_MESSAGE_ID,
    context: { kind: 'entry', refId: asInfoEntryId('preview-project-1') },
  },
]

/**
 * Replayed for every new preview turn. The answer is real Markdown with a list,
 * a table and inline emphasis, so the transcript renders what the contract
 * promises instead of a single plain paragraph.
 */
export const PREVIEW_CONVERSATION_SCRIPT: readonly ModelChunk[] = [
  { type: 'text', textDelta: '我会先按目标岗位整理一遍思路，再动手改简历。\n\n' },
  {
    type: 'text',
    textDelta:
      '1. **确认岗位重点**：前端工程化、性能优化与组件设计。\n' +
      '2. **挑选证据**：从项目经历里选三条能对上要求的记录。\n' +
      '3. **调整措辞**：把职责改写成结果，并保留可核对的数字。\n\n',
  },
  {
    type: 'text',
    textDelta:
      '| 匹配点 | 对应经历 | 证据 |\n' +
      '| --- | --- | --- |\n' +
      '| 性能优化 | 订单中台重构 | 核心链路吞吐提升 2.3 倍 |\n' +
      '| 组件化 | 校园二手交易平台 | 独立完成前后端页面 |\n' +
      '| 数据可视化 | 数据看板 | 复杂表格与图表交互 |\n\n',
  },
  {
    type: 'text',
    textDelta:
      '需要我按这个方向直接生成一版简历草稿吗？你也可以先补充其他想强调的经历。',
  },
]

/** A slower replay, long enough to watch the stream and to stop it mid-answer. */
export const PREVIEW_SLOW_SCRIPT: readonly ModelChunk[] = [
  { type: 'text', textDelta: '我正在逐个读取信息库里的条目，' },
  { type: 'text', textDelta: '先确认哪些经历和这个岗位直接相关。\n\n' },
  { type: 'text', textDelta: '目前的判断是：项目经历里有两段非常合适，' },
  { type: 'text', textDelta: '一段偏工程化，一段偏业务交付。\n\n' },
  { type: 'text', textDelta: '接下来我会把这两段整理成简历里的项目章节，' },
  { type: 'text', textDelta: '并把结果汇总成要点，' },
  { type: 'text', textDelta: '方便你在右侧创作面板里直接查看和修改。' },
]

/** Two visible deltas, then a provider refusal; the run ends failed. */
export const PREVIEW_FAILURE_SCRIPT: readonly ModelChunk[] = [
  { type: 'text', textDelta: '我先读取了岗位描述与信息库，' },
  { type: 'text', textDelta: '正在整理可以写入简历的条目。' },
]

/** The message the failure script ends with; shown on the assistant bubble. */
export const PREVIEW_FAILURE_MESSAGE =
  '模型服务返回 503：服务暂时不可用，请稍后重试。'
