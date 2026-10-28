/**
 * @file OpenAiCompatibleProvider
 * @description ModelProvider adapter for the OpenAI chat-completions wire
 * format, which serves OpenAI itself and the vendors that reproduce it. The
 * port speaks structured content parts; this file is the only place that knows
 * about `choices[].delta`, `image_url`, the usage-only frame and the `[DONE]`
 * sentinel.
 *
 * Responsibilities:
 * - Map ChatRequest parts (text, image, tool result) to the vendor payload
 * - Accumulate streamed tool-call fragments and emit them as whole calls
 * - Translate usage frames into ModelChunk.usage
 * - Surface failures as ModelCallError with the retry classification
 *
 * Constraints:
 * - A streamed tool call arrives as argument fragments keyed by index, and the
 *   name arrives only on the first fragment. Fragments are accumulated per
 *   index and emitted when the call completes, so the registry never receives
 *   half-parsed arguments.
 * - A frame that is not JSON, or that lacks the fields it is supposed to carry,
 *   is reported rather than skipped: a silently dropped tool call looks exactly
 *   like a model that chose not to call one.
 * - The API key is supplied by the composition root from the SecretStore. It
 *   travels in the Authorization header and never appears in an error message.
 */

import type {
  ChatRequest,
  ContentPart,
  ModelChunk,
  ModelProvider,
  ToolSchema,
} from '../../../domain/generation/ports/ModelProvider'
import { DomainError } from '../../../domain/shared/DomainError'
import { drainChunksAsText } from '../TauriHttpClient'
import type { HttpClient, OutboundStream } from '../TauriHttpClient'
import {
  ERROR_BODY_CHAR_LIMIT,
  ModelCallError,
  modelCallErrorForStatus,
  modelCallErrorForThrown,
  readRetryAfterSeconds,
} from './errors'
import { MAX_REQUEST_BODY_CHARACTER_LENGTH } from './httpTypes'

const COMPLETIONS_PATH = '/chat/completions'
const STREAM_SENTINEL = '[DONE]'
const ENDPOINT_LABEL = 'OpenAI-compatible endpoint'

export interface OpenAiCompatibleProviderConfig {
  /** Provider identity used by the run records. */
  readonly id: string
  readonly modelId: string
  /** Endpoint root, for example https://api.openai.com/v1. */
  readonly baseUrl: string
  /** Loaded from the SecretStore by the composition root. */
  readonly apiKey: string
  readonly http: HttpClient
  readonly supportsImages: boolean
  readonly maxOutputTokens?: number
  readonly connectTimeoutMs?: number
}

interface PendingToolCall {
  name: string
  argsJson: string
}

interface StreamFrame {
  readonly text: string
  readonly toolCallFragments: readonly unknown[]
  readonly finishReason: unknown
  readonly usage: { readonly promptTokens: number; readonly completionTokens: number } | null
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly id: string
  readonly modelId: string
  readonly supportsImages: boolean
  readonly #config: OpenAiCompatibleProviderConfig

  constructor(config: OpenAiCompatibleProviderConfig) {
    this.#config = config
    this.id = config.id
    this.modelId = config.modelId
    this.supportsImages = config.supportsImages
  }

  stream(
    request: ChatRequest,
    tools: readonly ToolSchema[],
    signal?: AbortSignal,
  ): AsyncIterable<ModelChunk> {
    return streamChatCompletion(this.#config, request, tools, signal)
  }
}

async function* streamChatCompletion(
  config: OpenAiCompatibleProviderConfig,
  request: ChatRequest,
  tools: readonly ToolSchema[],
  signal?: AbortSignal,
): AsyncIterable<ModelChunk> {
  const body = buildRequestBody(config, request, tools)
  let response: OutboundStream
  try {
    response = await config.http.openStream({
      method: 'POST',
      url: `${config.baseUrl.replace(/\/+$/, '')}${COMPLETIONS_PATH}`,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${config.apiKey}`,
      },
      body,
      connectTimeoutMs: config.connectTimeoutMs,
      signal,
    })
  } catch (failure) {
    if (signal?.aborted === true) return
    throw modelCallErrorForThrown(ENDPOINT_LABEL, failure)
  }
  if (response.status < 200 || response.status >= 300) {
    throw modelCallErrorForStatus(
      ENDPOINT_LABEL,
      response.status,
      await readErrorBody(response),
      readRetryAfterSeconds(response.headers),
    )
  }

  const pendingToolCalls = new Map<number, PendingToolCall>()
  try {
    for await (const data of response.serverSentEvents()) {
      if (signal?.aborted === true) return
      if (data === STREAM_SENTINEL) break
      const frame = readFrame(data)
      if (frame.usage !== null) {
        yield { type: 'usage', promptTokens: frame.usage.promptTokens, completionTokens: frame.usage.completionTokens }
      }
      if (frame.text !== '') yield { type: 'text', textDelta: frame.text }
      accumulateToolCallFragments(pendingToolCalls, frame.toolCallFragments)
      if (frame.finishReason === 'tool_calls') yield* emitPendingToolCalls(pendingToolCalls)
    }
    if (signal?.aborted !== true) yield* emitPendingToolCalls(pendingToolCalls)
  } catch (failure) {
    if (signal?.aborted === true) return
    if (failure instanceof ModelCallError) throw failure
    throw modelCallErrorForThrown(ENDPOINT_LABEL, failure)
  }
}

function buildRequestBody(
  config: OpenAiCompatibleProviderConfig,
  request: ChatRequest,
  tools: readonly ToolSchema[],
): string {
  const messages: Record<string, unknown>[] = []
  if (request.system !== null && request.system !== '') {
    messages.push({ role: 'system', content: request.system })
  }
  for (const message of request.messages) {
    messages.push({ role: message.role, content: renderContent(config, message.parts) })
  }
  const body: Record<string, unknown> = {
    model: config.modelId,
    messages,
    stream: true,
  }
  const maxOutputTokens = request.maxOutputTokens ?? config.maxOutputTokens
  if (maxOutputTokens !== undefined) body.max_tokens = maxOutputTokens
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parametersJsonSchema,
      },
    }))
  }
  const json = JSON.stringify(body)
  if (json.length > MAX_REQUEST_BODY_CHARACTER_LENGTH) {
    throw new DomainError(
      'attachmentTooLarge',
      '本次请求体超过模型服务的 20 MiB 上限，请减少图片或文字后重试。',
    )
  }
  return json
}

/** Plain text stays a string; anything with an image or a tool result becomes a part list. */
function renderContent(
  config: OpenAiCompatibleProviderConfig,
  parts: readonly ContentPart[],
): string | readonly Record<string, unknown>[] {
  const first = parts[0]
  if (parts.length === 1 && first !== undefined && first.kind === 'text') return first.text
  const content: Record<string, unknown>[] = []
  for (const part of parts) {
    if (part.kind === 'text') {
      content.push({ type: 'text', text: part.text })
      continue
    }
    if (part.kind === 'image') {
      if (!config.supportsImages) {
        throw new DomainError(
          'unsupportedImageType',
          '当前模型服务不支持图片输入，请在设置中切换支持图片的模型。',
        )
      }
      content.push({
        type: 'image_url',
        image_url: { url: `data:${part.mimeType};base64,${part.base64}` },
      })
      continue
    }
    content.push({ type: 'text', text: `Result of ${part.toolName}:\n${part.content}` })
  }
  return content
}

function readFrame(data: string): StreamFrame {
  const payload = requireRecord(parseJsonFrame(data), 'stream frame')
  // An error is reported inside a 200 response, and it carries no choices.
  // Falling through to the empty-delta branch would turn a provider failure
  // into a turn that simply said nothing, which the loop reports as completed.
  if (payload.error !== undefined && payload.error !== null) {
    throw new ModelCallError(`模型服务在流中报告错误：${JSON.stringify(payload.error)}`, {
      retryable: false,
      status: null,
    })
  }
  const usage = readUsage(payload.usage)
  const choices = payload.choices
  if (!Array.isArray(choices)) return { text: '', toolCallFragments: [], finishReason: null, usage }
  const choice = choices[0]
  if (choice === null || typeof choice !== 'object' || Array.isArray(choice)) {
    return { text: '', toolCallFragments: [], finishReason: null, usage }
  }
  const choiceRecord = choice as Record<string, unknown>
  const delta = choiceRecord.delta
  const deltaRecord =
    delta !== null && typeof delta === 'object' && !Array.isArray(delta)
      ? (delta as Record<string, unknown>)
      : {}
  const content = deltaRecord.content
  return {
    text: typeof content === 'string' ? content : '',
    toolCallFragments: Array.isArray(deltaRecord.tool_calls) ? deltaRecord.tool_calls : [],
    finishReason: choiceRecord.finish_reason,
    usage,
  }
}

function readUsage(value: unknown): StreamFrame['usage'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const promptTokens = record.prompt_tokens
  const completionTokens = record.completion_tokens
  if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') return null
  return { promptTokens, completionTokens }
}

function accumulateToolCallFragments(
  pending: Map<number, PendingToolCall>,
  fragments: readonly unknown[],
): void {
  fragments.forEach((fragment, position) => {
    if (fragment === null || typeof fragment !== 'object' || Array.isArray(fragment)) return
    const record = fragment as Record<string, unknown>
    // Providers omit `index` on some frames and rely on arrival order; falling
    // back to the position keeps a single-call stream working.
    const rawIndex = record.index
    const index = typeof rawIndex === 'number' ? rawIndex : position
    const existing = pending.get(index) ?? { name: '', argsJson: '' }
    const fn = record.function
    if (fn !== null && typeof fn === 'object' && !Array.isArray(fn)) {
      const fnRecord = fn as Record<string, unknown>
      if (typeof fnRecord.name === 'string' && fnRecord.name !== '') {
        existing.name = fnRecord.name
      }
      if (typeof fnRecord.arguments === 'string') {
        existing.argsJson += fnRecord.arguments
      }
    }
    pending.set(index, existing)
  })
}

async function* emitPendingToolCalls(
  pending: Map<number, PendingToolCall>,
): AsyncIterable<ModelChunk> {
  const indexes = [...pending.keys()].sort((left, right) => left - right)
  for (const index of indexes) {
    const call = pending.get(index)
    if (call === undefined) continue
    pending.delete(index)
    if (call.name === '') {
      throw new ModelCallError(
        `模型流在第 ${index} 个工具调用上从未给出工具名，无法执行。`,
        { retryable: false, status: null },
      )
    }
    yield { type: 'toolCall', name: call.name, argsJson: call.argsJson }
  }
}

async function readErrorBody(response: OutboundStream): Promise<string> {
  try {
    return await drainChunksAsText(response.chunks(), ERROR_BODY_CHAR_LIMIT)
  } catch {
    // The status is the diagnostic that matters; an unreadable body is not
    // allowed to replace it with a transport failure.
    return ''
  }
}

function parseJsonFrame(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch (failure) {
    throw new ModelCallError(
      `模型流返回了不是合法 JSON 的帧：${describeThrown(failure)}`,
      { retryable: false, status: null },
    )
  }
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelCallError(`模型流返回的 ${what} 不是 JSON 对象。`, {
      retryable: false,
      status: null,
    })
  }
  return value as Record<string, unknown>
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
