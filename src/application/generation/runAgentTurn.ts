/**
 * @file runAgentTurn
 * @description One assistant turn: append the user message, claim the run,
 * stream the answer, execute the tools the model requests, feed the results
 * back, and finish the run with a status.
 *
 * Responsibilities:
 * - Keep the persisted message state truthful at every point of the lifecycle:
 *   user message, streaming assistant message, tool cards, run status
 * - Emit the AgentEvent stream the chat interface renders
 * - Persist streamed text at most every 500 ms and always at the end of a turn
 * - Stop on cancellation, fail with a readable reason, and retry one turn when
 *   the provider says the failure was transient and nothing was written yet
 * - Hand every tool its ToolContext, so a write can be attributed to the run
 *
 * Constraints:
 * - The turn is not one transaction. Message writes, invocation writes and the
 *   run status are separate small transactions; the message state machine and
 *   the retry path are what make a partial turn recoverable.
 * - A conversation has at most one run; the database gate in
 *   `MessageRepository.createRun` returns the run already in flight, and this
 *   function returns it instead of starting a second stream.
 * - A cancellation that arrives while a tool runs takes effect after the tool
 *   settles: the call is bounded by its own timeout and letting it finish keeps
 *   the audit row truthful about what was written.
 * - Context blocks for the resume and the information library are produced by
 *   the layers that own those models, so this build leaves them null. The
 *   budget, truncation and history rules are implemented and tested here.
 */

import type {
  ChatMessage,
  ChatRequest,
  ContentPart,
  ModelChunk,
  ToolSchema,
} from '../../domain/generation/ports/ModelProvider'
import type { ModelProvider } from '../../domain/generation/ports/ModelProvider'
import { readModelCallFailure } from '../../domain/generation/ports/ModelProvider'
import type { ToolContext, ToolRegistry } from '../../domain/generation/ports/ToolRegistry'
import type { AgentEvent } from '../../domain/generation/AgentEvent'
import type { AgentRun } from '../../domain/generation/AgentRun'
import {
  cancelAgentRun,
  completeRun,
  failRun,
  recordRunUsage,
} from '../../domain/generation/AgentRun'
import type { Message, ToolMessagePayload } from '../../domain/conversation/Message'
import { DEFAULT_CONVERSATION_TITLE } from '../../domain/conversation/Conversation'
import { truncateToolDetail } from '../../domain/conversation/Message'
import type { MessageContext } from '../../domain/conversation/MessageContext'
import { DomainError, isDomainError } from '../../domain/shared/DomainError'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type {
  AgentRunId,
  AttachmentId,
  ConversationId,
  MessageId,
  ResumeId,
} from '../../domain/shared/branded-id'
import { asAgentRunId } from '../../domain/shared/branded-id'
import type { AgentRunRepository } from '../../domain/generation/ports/AgentRunRepository'
import type { AttachmentRepository } from '../../domain/conversation/ports/AttachmentRepository'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { FileStore } from '../../domain/conversation/ports/FileStore'
import type { MessageContextRepository } from '../../domain/conversation/ports/MessageContextRepository'
import type { MessageRepository } from '../../domain/conversation/ports/MessageRepository'
import type { JobPostingRepository } from '../../domain/generation/ports/JobPostingRepository'
import type { ToolInvocationRepository } from '../../domain/generation/ports/ToolInvocationRepository'
import { appendMessage } from '../conversation/appendMessage'
import type { AppendMessageInput } from '../conversation/appendMessage'
import { autoTitleConversation } from '../conversation/autoTitle'
import { findConversation } from '../conversation/renameConversation'
import {
  AGENT_CONTEXT_TOKEN_BUDGET,
  CONTEXT_HISTORY_MESSAGE_LIMIT,
  assembleAgentContext,
} from './context'
import type { AgentContext, AgentContextSources, ContextChip } from './context'
import { compactConversation } from './compactConversation'
import { redactSecret } from './redactSecret'
import { buildFixedSystemPromptSections, buildSystemPrompt } from './systemPrompt'
import { executeToolCall } from './toolExecution'
import { truncateToolResult } from './toolOutcome'

/** Hard ceiling of one model request, including the time spent streaming it. */
export const MODEL_TURN_TIMEOUT_MS = 120_000

/** Longest silence allowed between two streamed chunks. */
export const STREAM_IDLE_TIMEOUT_MS = 60_000

/** Ceiling of one tool execution. */
export const TOOL_TIMEOUT_MS = 30_000

/** Model round trips allowed in one run. */
export const MAX_TURNS = 8

/** Automatic retries allowed for one turn. */
export const RETRY_MAX = 1

/** Wait before the automatic retry. */
export const RETRY_BACKOFF_MS = 1_500

/** Persistence cadence for streamed text. */
export const STREAM_PERSIST_INTERVAL_MS = 500

/** Cancellation text shown on the run and its messages. */
export const CANCELLED_ERROR_TEXT = '已取消'

export interface RunLimits {
  readonly modelTurnTimeoutMs: number
  readonly streamIdleTimeoutMs: number
  readonly toolTimeoutMs: number
  readonly maxTurns: number
  readonly retryMax: number
  readonly retryBackoffMs: number
  readonly streamPersistIntervalMs: number
}

export const DEFAULT_RUN_LIMITS: RunLimits = {
  modelTurnTimeoutMs: MODEL_TURN_TIMEOUT_MS,
  streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  maxTurns: MAX_TURNS,
  retryMax: RETRY_MAX,
  retryBackoffMs: RETRY_BACKOFF_MS,
  streamPersistIntervalMs: STREAM_PERSIST_INTERVAL_MS,
}

export interface RunAgentTurnDeps {
  readonly model: ModelProvider
  /**
   * Model used for the automatic conversation title. null disables model
   * naming; the truncated first message is used instead.
   */
  readonly titleModel: ModelProvider | null
  readonly registry: ToolRegistry
  readonly conversations: ConversationRepository
  readonly messages: MessageRepository
  readonly messageContexts: MessageContextRepository
  readonly runs: AgentRunRepository
  readonly invocations: ToolInvocationRepository
  readonly jobPostings: JobPostingRepository
  readonly attachments: AttachmentRepository
  readonly fileStore: FileStore
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly emit: (event: AgentEvent) => void
  /** Aborts the turn. The run is kept, marked cancelled. */
  readonly signal: AbortSignal
  /** Credentials loaded for the provider; every persisted string is scrubbed. */
  readonly secrets: readonly string[]
  readonly maxOutputTokens?: number
  readonly limits?: Partial<RunLimits>
  /** Best-effort warnings, for example a failed title or summary call. */
  readonly onWarning?: (message: string, error: unknown) => void
  /** Delay used by the retry backoff; tests replace it with an immediate resolve. */
  readonly wait?: (milliseconds: number) => Promise<void>
}

export interface RunAgentTurnInput {
  readonly conversationId: ConversationId
  /** The user turn, already built by the caller. */
  readonly userMessage: AppendMessageInput
  /**
   * Set by the retry path: the user message is already stored, so the run
   * reuses it instead of appending a duplicate.
   */
  readonly existingUserMessageId?: MessageId
  /** The model the caller selected, or null to use the conversation default. */
  readonly model: { readonly providerId: string; readonly modelId: string } | null
  readonly activeResumeId: ResumeId | null
}

export async function runAgentTurn(
  deps: RunAgentTurnDeps,
  input: RunAgentTurnInput,
): Promise<AgentRun> {
  const limits: RunLimits = { ...DEFAULT_RUN_LIMITS, ...deps.limits }
  const wait = deps.wait ?? sleep
  let conversation = await findConversation(deps, input.conversationId)
  if (
    input.model !== null &&
    (conversation.providerId !== input.model.providerId ||
      conversation.modelId !== input.model.modelId)
  ) {
    conversation = {
      ...conversation,
      providerId: input.model.providerId,
      modelId: input.model.modelId,
    }
    await deps.conversations.update(conversation)
  }

  const userMessage =
    input.existingUserMessageId === undefined
      ? await appendMessage(deps, input.userMessage)
      : await loadExistingUserMessage(deps, input.existingUserMessageId)
  const candidate: AgentRun = {
    id: asAgentRunId(deps.ids.next()),
    conversationId: input.conversationId,
    resumeId: input.activeResumeId,
    jobPostingId: null,
    status: 'running',
    errorText: null,
    promptTokens: null,
    completionTokens: null,
    startedAt: deps.clock.now(),
    endedAt: null,
  }
  const claimed = await deps.messages.createRun(candidate)
  if (claimed.id !== candidate.id) {
    // Another turn is already answering this conversation. The database gate
    // returned its run; this call does not start a second stream.
    return claimed
  }
  let run = claimed

  if (userMessage.seq === 1 && conversation.title === DEFAULT_CONVERSATION_TITLE) {
    try {
      await autoTitleConversation(
        { conversations: deps.conversations, model: deps.titleModel, clock: deps.clock },
        { conversationId: input.conversationId, firstUserMessage: userMessage.markdown },
      )
    } catch (failure) {
      deps.onWarning?.('会话自动命名失败。', failure)
    }
  }

  const assistant = await appendMessage(deps, {
    conversationId: input.conversationId,
    kind: 'assistant',
    markdown: '',
    runId: run.id,
  })
  deps.emit({
    type: 'runStarted',
    runId: run.id,
    conversationId: input.conversationId,
    userMessageId: userMessage.id,
    assistantMessageId: assistant.id,
  })

  let assistantMarkdown = ''
  let lastPersistedAtMs = Date.parse(deps.clock.now())
  const openToolMessages: Message[] = []
  const toolContext = buildToolContext(deps, run.id, input.conversationId)

  const updateAssistant = async (
    status: Message['status'],
    errorText: string | null,
  ): Promise<void> => {
    await deps.messages.update({
      ...assistant,
      markdown: assistantMarkdown,
      status,
      errorText,
      updatedAt: deps.clock.now(),
    })
    lastPersistedAtMs = Date.parse(deps.clock.now())
  }

  let chatMessages: ChatMessage[] = []
  let systemPrompt = ''
  try {
    const userParts = await buildUserParts(deps, userMessage.markdown, userMessage.attachmentIds)
    chatMessages = [{ role: 'user', parts: userParts }]
    const context = await readContext(deps, input)
    if (!context.ok) {
      return await finishFailed(
        deps,
        run,
        assistant,
        assistantMarkdown,
        openToolMessages,
        context.errorText,
        false,
      )
    }
    systemPrompt = buildSystemPrompt(context.value)
  } catch (failure) {
    return await finishFailed(
      deps,
      run,
      assistant,
      assistantMarkdown,
      openToolMessages,
      describeFailure(failure),
      false,
    )
  }

  let retriesUsed = 0
  for (let turn = 1; turn <= limits.maxTurns; turn += 1) {
    if (deps.signal.aborted) {
      return await finishCancelled(deps, run, assistant, assistantMarkdown, openToolMessages)
    }
    deps.emit({ type: 'turnStarted', turn })
    let turnText = ''
    let executedToolsThisTurn = false
    let turnToolCalls: readonly PendingToolCall[] = []
    for (;;) {
      if (deps.signal.aborted) {
        return await finishCancelled(deps, run, assistant, assistantMarkdown, openToolMessages)
      }
      const result = await streamTurn({
        model: deps.model,
        request: {
          system: systemPrompt,
          messages: chatMessages,
          maxOutputTokens: deps.maxOutputTokens,
        },
        tools: deps.registry.schemas(),
        parentSignal: deps.signal,
        idleTimeoutMs: limits.streamIdleTimeoutMs,
        turnTimeoutMs: limits.modelTurnTimeoutMs,
        onTextDelta: async (delta: string) => {
          turnText += delta
          assistantMarkdown += delta
          deps.emit({ type: 'textDelta', messageId: assistant.id, delta })
          if (Date.parse(deps.clock.now()) - lastPersistedAtMs >= limits.streamPersistIntervalMs) {
            await deps.messages.update({
              ...assistant,
              markdown: assistantMarkdown,
              updatedAt: deps.clock.now(),
            })
            lastPersistedAtMs = Date.parse(deps.clock.now())
          }
        },
        onUsage: (usage) => {
          run = recordRunUsage(run, usage)
          deps.emit({ type: 'usage', ...usage })
        },
      })
      if (result.cancelled) {
        return await finishCancelled(deps, run, assistant, assistantMarkdown, openToolMessages)
      }
      if (result.failure !== null) {
        const mayRetry =
          retriesUsed < limits.retryMax &&
          result.failure.retryable &&
          !result.emittedText &&
          !executedToolsThisTurn
        if (mayRetry) {
          retriesUsed += 1
          await wait(limits.retryBackoffMs)
          continue
        }
        return await finishFailed(
          deps,
          run,
          assistant,
          assistantMarkdown,
          openToolMessages,
          result.failure.message,
          result.failure.retryable,
        )
      }
      turnToolCalls = result.toolCalls
      break
    }

    await updateAssistant('streaming', null)

    if (turnToolCalls.length === 0) {
      return await finishCompleted(deps, run, assistant, assistantMarkdown)
    }

    const toolResults: ContentPart[] = []
    for (const call of turnToolCalls) {
      if (deps.signal.aborted) {
        return await finishCancelled(deps, run, assistant, assistantMarkdown, openToolMessages)
      }
      executedToolsThisTurn = true
      const tool = deps.registry.get(call.name)
      const label = deps.registry.labelFor(call.name)
      const risk = tool?.risk ?? 'read'
      const toolMessage = await appendMessage(deps, {
        conversationId: input.conversationId,
        kind: 'tool',
        runId: run.id,
        tool: {
          toolName: call.name,
          invocationId: null,
          risk,
          label,
          detail: '',
          changeIds: [],
          revisionId: null,
          resumeId: null,
        },
      })
      openToolMessages.push(toolMessage)
      const outcome = await executeToolCall(
        {
          registry: deps.registry,
          invocations: deps.invocations,
          clock: deps.clock,
          ids: deps.ids,
          emit: deps.emit,
          secrets: deps.secrets,
          toolTimeoutMs: limits.toolTimeoutMs,
        },
        {
          runId: run.id,
          message: toolMessage,
          toolName: call.name,
          argsJson: call.argsJson,
          context: toolContext,
        },
      )
      const detail = truncateToolDetail(redactSecret(outcome.content, deps.secrets))
      const payload: ToolMessagePayload = {
        toolName: call.name,
        invocationId: outcome.invocationId,
        risk,
        label,
        detail,
        changeIds: outcome.metadata.changeIds,
        revisionId: outcome.metadata.revisionId,
        resumeId: outcome.metadata.resumeId,
      }
      const finishedTool: Message = {
        ...toolMessage,
        status: outcome.status === 'ok' ? 'complete' : 'failed',
        tool: payload,
        errorText: outcome.status === 'failed' ? detail : null,
        updatedAt: deps.clock.now(),
      }
      await deps.messages.update(finishedTool)
      openToolMessages[openToolMessages.length - 1] = finishedTool
      toolResults.push({
        kind: 'toolResult',
        toolName: call.name,
        content: truncateToolResult(outcome.content),
      })
      if (outcome.fault !== undefined) {
        return await finishFailed(
          deps,
          run,
          assistant,
          assistantMarkdown,
          openToolMessages,
          outcome.fault,
          false,
        )
      }
    }
    if (deps.signal.aborted) {
      return await finishCancelled(deps, run, assistant, assistantMarkdown, openToolMessages)
    }
    if (turnText !== '') {
      chatMessages.push({ role: 'assistant', parts: [{ kind: 'text', text: turnText }] })
    }
    chatMessages.push({ role: 'user', parts: toolResults })
  }

  return await finishFailed(
    deps,
    run,
    assistant,
    assistantMarkdown,
    openToolMessages,
    `本轮已达到最大轮次（${limits.maxTurns}），未能完成。`,
    false,
  )
}

interface PendingToolCall {
  readonly name: string
  readonly argsJson: string
}

interface StreamFailure {
  readonly message: string
  readonly retryable: boolean
}

interface StreamTurnResult {
  readonly cancelled: boolean
  readonly failure: StreamFailure | null
  readonly toolCalls: readonly PendingToolCall[]
  readonly emittedText: boolean
}

interface StreamTurnOptions {
  readonly model: ModelProvider
  readonly request: ChatRequest
  readonly tools: readonly ToolSchema[]
  readonly parentSignal: AbortSignal
  readonly idleTimeoutMs: number
  readonly turnTimeoutMs: number
  readonly onTextDelta: (delta: string) => Promise<void>
  readonly onUsage: (usage: {
    readonly promptTokens: number
    readonly completionTokens: number
  }) => void
}

/**
 * Streams one model request. The turn and idle timers abort the adapter's
 * request through the signal it was handed; the result reports which of the
 * three termination reasons ended the stream.
 */
async function streamTurn(options: StreamTurnOptions): Promise<StreamTurnResult> {
  const controller = new AbortController()
  const detach = forwardAbort(options.parentSignal, controller)
  let turnTimedOut = false
  let idleTimedOut = false
  const turnTimer = setTimeout(() => {
    turnTimedOut = true
    controller.abort()
  }, options.turnTimeoutMs)
  let idleTimer = setTimeout(() => {
    idleTimedOut = true
    controller.abort()
  }, options.idleTimeoutMs)
  const resetIdleTimer = (): void => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimedOut = true
      controller.abort()
    }, options.idleTimeoutMs)
  }
  const toolCalls: PendingToolCall[] = []
  let emittedText = false
  const timeoutFailure = (): StreamFailure =>
    turnTimedOut
      ? { message: `模型调用超过 ${options.turnTimeoutMs} ms，已中止。`, retryable: false }
      : { message: `模型响应空闲超过 ${options.idleTimeoutMs} ms。`, retryable: true }
  try {
    const modelStream = options.model.stream(options.request, options.tools, controller.signal)
    const iterator = modelStream[Symbol.asyncIterator]()
    try {
      for (;;) {
        if (options.parentSignal.aborted) {
          return { cancelled: true, failure: null, toolCalls, emittedText }
        }
        const next = await iterator.next()
        if (next.done === true) break
        resetIdleTimer()
        const chunk: ModelChunk = next.value
        if (chunk.type === 'text') {
          emittedText = true
          await options.onTextDelta(chunk.textDelta)
          continue
        }
        if (chunk.type === 'toolCall') {
          toolCalls.push({ name: chunk.name, argsJson: chunk.argsJson })
          continue
        }
        options.onUsage({
          promptTokens: chunk.promptTokens,
          completionTokens: chunk.completionTokens,
        })
      }
    } finally {
      await closeIterator(iterator)
    }
    if (options.parentSignal.aborted) {
      return { cancelled: true, failure: null, toolCalls, emittedText }
    }
    if (turnTimedOut || idleTimedOut) {
      return { cancelled: false, failure: timeoutFailure(), toolCalls, emittedText }
    }
    return { cancelled: false, failure: null, toolCalls, emittedText }
  } catch (failure) {
    if (options.parentSignal.aborted) {
      return { cancelled: true, failure: null, toolCalls, emittedText }
    }
    if (turnTimedOut || idleTimedOut) {
      return { cancelled: false, failure: timeoutFailure(), toolCalls, emittedText }
    }
    return {
      cancelled: false,
      failure: {
        message: describeFailure(failure),
        retryable: readModelCallFailure(failure)?.retryable ?? false,
      },
      toolCalls,
      emittedText,
    }
  } finally {
    clearTimeout(turnTimer)
    clearTimeout(idleTimer)
    detach()
  }
}

/** Releases the adapter's connection without waiting for a generator to settle. */
async function closeIterator(iterator: AsyncIterator<ModelChunk>): Promise<void> {
  if (iterator.return === undefined) return
  try {
    const closing = iterator.return()
    if (closing !== undefined) await closing
  } catch {
    // The stream was being abandoned anyway; the abort already released it.
  }
}

function forwardAbort(parent: AbortSignal, controller: AbortController): () => void {
  if (parent.aborted) {
    controller.abort()
    return () => undefined
  }
  const onAbort = (): void => controller.abort()
  parent.addEventListener('abort', onAbort, { once: true })
  return () => parent.removeEventListener('abort', onAbort)
}

/** Builds the ToolContext handed to every call of this run. */
function buildToolContext(
  deps: RunAgentTurnDeps,
  runId: AgentRunId,
  conversationId: ConversationId,
): ToolContext {
  return {
    conversations: deps.conversations,
    messages: deps.messages,
    jobPostings: deps.jobPostings,
    attachments: deps.attachments,
    fileStore: deps.fileStore,
    clock: deps.clock,
    ids: deps.ids,
    runId,
    conversationId,
    emit: deps.emit,
  }
}

/** Builds the user parts: the text plus every image attachment it names. */
async function buildUserParts(
  deps: RunAgentTurnDeps,
  markdown: string,
  attachmentIds: readonly AttachmentId[],
): Promise<readonly ContentPart[]> {
  const parts: ContentPart[] = []
  if (markdown !== '') parts.push({ kind: 'text', text: markdown })
  if (attachmentIds.length === 0) {
    return parts.length === 0 ? [{ kind: 'text', text: '' }] : parts
  }
  const attachments = await deps.attachments.listByIds(attachmentIds)
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      if (!deps.model.supportsImages) {
        throw new DomainError(
          'unsupportedImageType',
          '当前模型不支持图片输入，请改用文本描述，或在设置中切换支持图片的模型。',
        )
      }
      const bytes = await deps.fileStore.read(attachment.storageName)
      parts.push({ kind: 'image', mimeType: attachment.mimeType, base64: toBase64(bytes) })
      continue
    }
    throw new DomainError(
      'unsupportedImageType',
      `当前版本不支持发送 ${attachment.mimeType} 附件，请改用文本粘贴。`,
    )
  }
  return parts
}

/**
 * Assembles the context for this turn. History comes from the repository; the
 * resume summary and library overview are supplied by the layers that own those
 * models, so this build passes null for both.
 */
async function readContext(
  deps: RunAgentTurnDeps,
  input: RunAgentTurnInput,
): Promise<
  | { readonly ok: true; readonly value: AgentContext }
  | { readonly ok: false; readonly errorText: string }
> {
  const recent = await deps.messages.listByConversation(
    input.conversationId,
    CONTEXT_HISTORY_MESSAGE_LIMIT + 1,
  )
  const history = recent
    .filter((message) => message.kind !== 'tool')
    .map((message) => ({
      role: message.kind === 'assistant' ? ('assistant' as const) : ('user' as const),
      text: message.markdown,
    }))
  const chips: ContextChip[] = []
  let jobPosting: string | null = null
  for (const context of input.userMessage.contexts ?? []) {
    const resolved = await resolveChip(deps, context)
    if (resolved.jobPosting !== null && jobPosting === null) {
      jobPosting = resolved.jobPosting
    }
    chips.push(resolved.chip)
  }
  const conversation = await deps.conversations.findById(input.conversationId)
  const sources: AgentContextSources = {
    preamble: buildFixedSystemPromptSections(),
    resumeSummary: null,
    libraryOverview: null,
    chips,
    jobPosting,
    history,
    hasEarlierMessages: recent.length > CONTEXT_HISTORY_MESSAGE_LIMIT,
    summary: conversation?.summary ?? null,
  }
  const assembled = assembleAgentContext(sources)
  if (!assembled.ok) {
    return {
      ok: false,
      errorText: `上下文超出预算（${assembled.error.estimatedTokens}/${AGENT_CONTEXT_TOKEN_BUDGET} token），请清空部分上下文后重试。`,
    }
  }
  return { ok: true, value: assembled.value }
}

async function resolveChip(
  deps: RunAgentTurnDeps,
  context: MessageContext,
): Promise<{ readonly chip: ContextChip; readonly jobPosting: string | null }> {
  if (context.kind === 'jobPosting') {
    const posting = await deps.jobPostings.findById(context.refId)
    if (posting === null) {
      return {
        chip: { kind: context.kind, refId: context.refId, text: '（岗位描述已删除）' },
        jobPosting: null,
      }
    }
    return {
      chip: { kind: context.kind, refId: context.refId, text: '（全文见「岗位描述」一节）' },
      jobPosting: posting.rawText,
    }
  }
  return {
    chip: {
      kind: context.kind,
      refId: context.refId,
      text: '（内容由工具按需读取）',
    },
    jobPosting: null,
  }
}

async function finishCompleted(
  deps: RunAgentTurnDeps,
  run: AgentRun,
  assistant: Message,
  markdown: string,
): Promise<AgentRun> {
  await deps.messages.update({
    ...assistant,
    markdown,
    status: 'complete',
    errorText: null,
    updatedAt: deps.clock.now(),
  })
  const completed = completeRun(run, deps.clock.now())
  await deps.runs.save(completed)
  deps.emit({ type: 'done', status: 'completed', runId: completed.id, errorText: null })
  await touchConversation(deps, assistant.conversationId)
  try {
    await compactConversation(
      {
        conversations: deps.conversations,
        messages: deps.messages,
        model: deps.model,
        clock: deps.clock,
      },
      { conversationId: assistant.conversationId },
    )
  } catch (failure) {
    deps.onWarning?.('对话摘要压缩失败。', failure)
  }
  return completed
}

async function finishCancelled(
  deps: RunAgentTurnDeps,
  run: AgentRun,
  assistant: Message,
  markdown: string,
  openToolMessages: readonly Message[],
): Promise<AgentRun> {
  await deps.messages.update({
    ...assistant,
    markdown,
    status: 'cancelled',
    errorText: CANCELLED_ERROR_TEXT,
    updatedAt: deps.clock.now(),
  })
  for (const toolMessage of openToolMessages) {
    if (toolMessage.status !== 'running') continue
    await deps.messages.update({
      ...toolMessage,
      status: 'failed',
      errorText: CANCELLED_ERROR_TEXT,
      updatedAt: deps.clock.now(),
    })
  }
  const cancelled = cancelAgentRun(run, deps.clock.now())
  await deps.runs.save(cancelled)
  deps.emit({
    type: 'done',
    status: 'cancelled',
    runId: cancelled.id,
    errorText: CANCELLED_ERROR_TEXT,
  })
  await touchConversation(deps, assistant.conversationId)
  return cancelled
}

async function finishFailed(
  deps: RunAgentTurnDeps,
  run: AgentRun,
  assistant: Message,
  markdown: string,
  openToolMessages: readonly Message[],
  reason: string,
  retryable: boolean,
): Promise<AgentRun> {
  const errorText = redactSecret(reason, deps.secrets)
  await deps.messages.update({
    ...assistant,
    markdown,
    status: 'failed',
    errorText,
    updatedAt: deps.clock.now(),
  })
  for (const toolMessage of openToolMessages) {
    if (toolMessage.status !== 'running') continue
    await deps.messages.update({
      ...toolMessage,
      status: 'failed',
      errorText,
      updatedAt: deps.clock.now(),
    })
  }
  const failed = failRun(run, errorText, deps.clock.now())
  await deps.runs.save(failed)
  deps.emit({ type: 'error', message: errorText, retryable })
  deps.emit({ type: 'done', status: 'failed', runId: failed.id, errorText })
  await touchConversation(deps, assistant.conversationId)
  return failed
}

async function touchConversation(
  deps: RunAgentTurnDeps,
  conversationId: ConversationId,
): Promise<void> {
  const conversation = await deps.conversations.findById(conversationId)
  if (conversation === null) return
  await deps.conversations.update({ ...conversation, updatedAt: deps.clock.now() })
}

function describeFailure(error: unknown): string {
  if (isDomainError(error)) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/** Loads the user turn the retry path keeps instead of appending a new one. */
async function loadExistingUserMessage(
  deps: RunAgentTurnDeps,
  messageId: MessageId,
): Promise<Message> {
  const message = await deps.messages.findById(messageId)
  if (message === null) {
    throw new DomainError('messageNotFound', '要重试的用户消息不存在。', {
      entity: 'message',
      id: messageId,
      blockers: [],
    })
  }
  return message
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
