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
import type {
  ChatRequest,
  ModelChunk,
} from '../../domain/generation/ports/ModelProvider'
import type { ScriptedTurn } from './ScriptedModelProvider'
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


/** The sample posting the preview tool chain analyzes. */
const PREVIEW_JOB_DESCRIPTION = [
  '岗位：后端开发工程师（电商中台）',
  '职责：负责订单与结算链路的设计、开发与性能优化；',
  '参与服务拆分与稳定性建设。',
  '要求：熟悉 TypeScript 或 Java，熟悉关系型数据库与缓存；',
  '有高并发系统经验者优先。',
].join('\n')

/** The summary text the preview chain writes into the resume. */
const PREVIEW_SUMMARY_TEXT =
  '三年后端开发经验，主导订单中台结算链路优化与领域服务拆分，' +
  '习惯用数据验证方案，注重可观测与可回滚的小步迭代。'

function toolCall(name: string, args: unknown): ModelChunk {
  return { type: 'toolCall', name, argsJson: JSON.stringify(args) }
}

function textChunks(lines: readonly string[]): readonly ModelChunk[] {
  return lines.map((line) => ({ type: 'text' as const, textDelta: line }))
}

/** Every tool result the request carries, in call order. */
function toolResultContents(request: ChatRequest): readonly string[] {
  const contents: string[] = []
  for (const message of request.messages) {
    for (const part of message.parts) {
      if (part.kind === 'toolResult') contents.push(part.content)
    }
  }
  return contents
}

/** The value of the newest tool result whose JSON parses, or null. */
function lastToolValue(request: ChatRequest): Record<string, unknown> | null {
  const contents = toolResultContents(request)
  for (let index = contents.length - 1; index >= 0; index -= 1) {
    const content = contents[index] ?? ''
    try {
      const envelope = JSON.parse(content) as { ok?: unknown; value?: unknown }
      if (envelope.ok === true && typeof envelope.value === 'object' && envelope.value !== null) {
        return envelope.value as Record<string, unknown>
      }
    } catch {
      continue
    }
  }
  return null
}

function resumeIdOf(request: ChatRequest): string | null {
  const value = lastToolValue(request)
  return value !== null && typeof value.resumeId === 'string' ? value.resumeId : null
}

function sectionIdsOf(request: ChatRequest): readonly string[] {
  const value = lastToolValue(request)
  if (value === null || !Array.isArray(value.sections)) return []
  return value.sections
    .map((section) =>
      typeof section === 'object' && section !== null && typeof (section as { sectionId?: unknown }).sectionId === 'string'
        ? ((section as { sectionId: string }).sectionId)
        : null,
    )
    .filter((sectionId): sectionId is string => sectionId !== null)
}

const PREVIEW_SELECTION = [
  { moduleKind: 'personal' as const, entryIds: ['preview-personal-1'] },
  { moduleKind: 'jobIntent' as const, entryIds: ['preview-job-intent-1'] },
  { moduleKind: 'education' as const, entryIds: ['preview-education-1'] },
  { moduleKind: 'internship' as const, entryIds: ['preview-internship-1'] },
  { moduleKind: 'project' as const, entryIds: ['preview-project-1', 'preview-project-2'] },
  { moduleKind: 'skill' as const, entryIds: ['preview-skill-1', 'preview-skill-2'] },
]

/**
 * The scripted end-to-end chain: analyze the posting (whose extraction is its
 * own model request), search the library, create a resume with a selection, read
 * it back for its identifiers, reorder chapters, write the summary and check the
 * layout before reporting. Later turns derive their identifiers from the tool
 * results the run loop fed back, which is the same conversation shape a real
 * model sees.
 */
export const PREVIEW_TOOL_CHAIN_TURNS: readonly ScriptedTurn[] = [
  () => [toolCall('analyzeJobDescription', { text: PREVIEW_JOB_DESCRIPTION })],
  // The extraction use case runs its own request behind the tool; its answer is
  // the structured parse. Every statement below is copied from the posting.
  () => [
    {
      type: 'text',
      textDelta: JSON.stringify({
        title: '后端开发工程师',
        company: null,
        responsibilities: [
          '负责订单与结算链路的设计、开发与性能优化',
          '参与服务拆分与稳定性建设',
        ],
        requirements: ['熟悉 TypeScript 或 Java', '熟悉关系型数据库与缓存'],
        keywords: ['TypeScript', 'Java', '高并发'],
      }),
    },
  ],
  () => [toolCall('searchInfoEntries', { keyword: '项目' })],
  () => [
    toolCall('createResume', {
      title: '后端开发工程师简历',
      targetJob: { title: '后端开发工程师', company: '字节跳动' },
      templateId: 'classic-single',
      selection: PREVIEW_SELECTION,
    }),
  ],
  (request) => {
    const resumeId = resumeIdOf(request)
    return resumeId === null
      ? textChunks(['创建简历没有返回标识，先停在这里。'])
      : [toolCall('getResume', { resumeId })]
  },
  (request) => {
    const resumeId = resumeIdOf(request)
    const sectionIds = sectionIdsOf(request)
    if (resumeId === null || sectionIds.length === 0) {
      return textChunks(['读取简历没有返回章节，先停在这里。'])
    }
    return [
      toolCall('setSectionOrder', {
        resumeId,
        orderedSectionIds: [...sectionIds].reverse(),
      }),
    ]
  },
  (request) => {
    const resumeId = resumeIdOf(request)
    return resumeId === null
      ? textChunks(['调整章节后没有拿到简历标识，先停在这里。'])
      : [toolCall('writeResumeSummary', { resumeId, text: PREVIEW_SUMMARY_TEXT })]
  },
  (request) => {
    const resumeId = resumeIdOf(request)
    return resumeId === null
      ? textChunks(['写总结后没有拿到简历标识，先停在这里。'])
      : [toolCall('checkLayoutOverflow', { resumeId })]
  },
  () =>
    textChunks([
      '我已经完成这一轮简历整理：\n\n',
      '1. 分析了岗位描述，提取出订单、结算与高并发相关的重点。\n',
      '2. 从信息库挑选了个人信息、求职意向、教育、实习、项目与技能条目。\n',
      '3. 创建简历、调整章节顺序，并写入面向该岗位的总结。\n',
      '4. 检查了排版溢出，结果见上方的工具卡片。\n\n',
      '右侧简历面板可以查看结果；每张写操作卡片都能单独撤销。',
    ]),
]
