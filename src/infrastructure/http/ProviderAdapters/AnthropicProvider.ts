/**
 * @file AnthropicProvider
 * @description ModelProvider adapter for Anthropic's messages wire format. The
 * port speaks structured content parts; this file is the only place that knows
 * about `content_block_start`, the text and input-json delta types, the usage
 * events, and the `anthropic-version` header.
 *
 * Responsibilities:
 * - Map ChatRequest parts (text, image, tool result) to the messages payload
 * - Accumulate tool_use blocks and emit one ModelChunk per completed call
 * - Translate the two usage frames into one ModelChunk.usage
 * - Surface failures as ModelCallError with the retry classification
 *
 * Constraints:
 * - `max_tokens` is required by the wire format. It comes from the request, the
 *   provider configuration, or the format default, in that order.
 * - The API key is supplied by the composition root from the SecretStore and
 *   travels in the x-api-key header; it never appears in an error message.
 * - A tool_use block that opened without a name is reported: dispatching it is
 *   impossible and silently dropping it would look like the model chose not to
 *   act.
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

const MESSAGES_PATH = '/v1/messages'
const API_VERSION = '2023-06-01'
const ENDPOINT_LABEL = 'Anthropic messages endpoint'
/** The wire format's own default when a caller has no opinion. */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

export interface AnthropicProviderConfig {
  readonly id: string
  readonly modelId: string
  /** Endpoint root, for example https://api.anthropic.com. */
  readonly baseUrl: string
  /** Loaded from the SecretStore by the composition root. */
  readonly apiKey: string
  readonly http: HttpClient
  readonly supportsImages: boolean
  readonly maxOutputTokens?: number
  readonly connectTimeoutMs?: number
}

interface OpenToolCall {
  readonly name: string
  argsJson: string
}

/** Usage arrives split across message_start (input) and message_delta (output). */
interface UsageAccumulator {
  promptTokens: number | null
  completionTokens: number | null
  emitted: boolean
}

export class AnthropicProvider implements ModelProvider {
  readonly id: string
  readonly modelId: string
  readonly supportsImages: boolean
  readonly #config: AnthropicProviderConfig

  constructor(config: AnthropicProviderConfig) {
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
    return streamMessages(this.#config, request, tools, signal)
  }
}

async function* streamMessages(
  config: AnthropicProviderConfig,
  request: ChatRequest,
  tools: readonly ToolSchema[],
  signal?: AbortSignal,
): AsyncIterable<ModelChunk> {
  const body = buildRequestBody(config, request, tools)
  let response: OutboundStream
  try {
    response = await config.http.openStream({
      method: 'POST',
      url: `${config.baseUrl.replace(/\/+$/, '')}${MESSAGES_PATH}`,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'x-api-key': config.apiKey,
        'anthropic-version': API_VERSION,
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

  const openToolCalls = new Map<number, OpenToolCall>()
  const usage: UsageAccumulator = { promptTokens: null, completionTokens: null, emitted: false }
  try {
    for await (const data of response.serverSentEvents()) {
      if (signal?.aborted === true) return
      const event = requireRecord(parseJsonFrame(data), 'stream event')
      const chunks = applyStreamEvent(event, openToolCalls, usage)
      for (const chunk of chunks) yield chunk
      if (event.type === 'message_stop') break
    }
  } catch (failure) {
    if (signal?.aborted === true) return
    if (failure instanceof ModelCallError) throw failure
    throw modelCallErrorForThrown(ENDPOINT_LABEL, failure)
  }
  // A stream cut short after the last fragment still hands over what it
  // assembled rather than losing the call.
  for (const chunk of closeEveryOpenToolCall(openToolCalls)) yield chunk
  const usageChunk = flushUsage(usage)
  if (usageChunk !== null) yield usageChunk
}

/**
 * One event, one meaning. Each branch returns the chunks the port speaks; an
 * event that only moved state returns none.
 */
function applyStreamEvent(
  event: Record<string, unknown>,
  openToolCalls: Map<number, OpenToolCall>,
  usage: UsageAccumulator,
): ModelChunk[] {
  switch (event.type) {
    case 'message_start':
      readMessageStartUsage(event, usage)
      return []
    case 'content_block_start':
      openToolUseBlock(event, openToolCalls)
      return []
    case 'content_block_delta': {
      const text = readTextDelta(event)
      if (text !== null) return [{ type: 'text', textDelta: text }]
      appendToolArguments(event, openToolCalls)
      return []
    }
    case 'content_block_stop': {
      const call = closeToolUseBlock(event, openToolCalls)
      return call === null ? [] : [call]
    }
    case 'message_delta':
      readMessageDeltaUsage(event, usage)
      return flushUsageChunk(usage)
    case 'error':
      throw new ModelCallError(`模型服务在流中报告错误：${JSON.stringify(event.error)}`, {
        retryable: false,
        status: null,
      })
    default:
      // ping and the event types this adapter has no meaning for.
      return []
  }
}

function readMessageStartUsage(event: Record<string, unknown>, usage: UsageAccumulator): void {
  const message = event.message
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return
  const messageUsage = (message as Record<string, unknown>).usage
  if (messageUsage === null || typeof messageUsage !== 'object' || Array.isArray(messageUsage)) return
  const inputTokens = (messageUsage as Record<string, unknown>).input_tokens
  if (typeof inputTokens === 'number') usage.promptTokens = inputTokens
}

function readMessageDeltaUsage(event: Record<string, unknown>, usage: UsageAccumulator): void {
  const deltaUsage = event.usage
  if (deltaUsage === null || typeof deltaUsage !== 'object' || Array.isArray(deltaUsage)) return
  const record = deltaUsage as Record<string, unknown>
  if (typeof record.input_tokens === 'number') usage.promptTokens = record.input_tokens
  if (typeof record.output_tokens === 'number') usage.completionTokens = record.output_tokens
}

function flushUsageChunk(usage: UsageAccumulator): ModelChunk[] {
  const chunk = flushUsage(usage)
  return chunk === null ? [] : [chunk]
}

/** Emits the accumulated usage once; later frames do not repeat it. */
function flushUsage(usage: UsageAccumulator): ModelChunk | null {
  if (usage.emitted) return null
  if (usage.promptTokens === null && usage.completionTokens === null) return null
  usage.emitted = true
  return {
    type: 'usage',
    promptTokens: usage.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? 0,
  }
}

/** The text this delta carries, or null when it is not a text delta. */
function readTextDelta(event: Record<string, unknown>): string | null {
  const delta = requireRecord(event.delta, 'content_block_delta.delta')
  if (delta.type !== 'text_delta') return null
  const text = delta.text
  return typeof text === 'string' && text !== '' ? text : null
}

function appendToolArguments(
  event: Record<string, unknown>,
  openToolCalls: Map<number, OpenToolCall>,
): void {
  const delta = requireRecord(event.delta, 'content_block_delta.delta')
  if (delta.type !== 'input_json_delta') return
  const index = readBlockIndex(event)
  const open = openToolCalls.get(index)
  if (open === undefined) {
    throw new ModelCallError(
      `模型流为第 ${index} 个内容块发送了参数片段，但从未打开对应的 tool_use 块。`,
      { retryable: false, status: null },
    )
  }
  if (typeof delta.partial_json === 'string') open.argsJson += delta.partial_json
}

function openToolUseBlock(
  event: Record<string, unknown>,
  openToolCalls: Map<number, OpenToolCall>,
): void {
  const block = requireRecord(event.content_block, 'content_block_start.content_block')
  if (block.type !== 'tool_use') return
  const name = block.name
  if (typeof name !== 'string' || name === '') {
    throw new ModelCallError('模型流打开了一个没有工具名的 tool_use 块，无法执行。', {
      retryable: false,
      status: null,
    })
  }
  openToolCalls.set(readBlockIndex(event), { name, argsJson: '' })
}

function closeToolUseBlock(
  event: Record<string, unknown>,
  openToolCalls: Map<number, OpenToolCall>,
): ModelChunk | null {
  const index = readBlockIndex(event)
  const open = openToolCalls.get(index)
  if (open === undefined) return null
  openToolCalls.delete(index)
  return { type: 'toolCall', name: open.name, argsJson: open.argsJson === '' ? '{}' : open.argsJson }
}

/** In block order, so a stream that stops between two calls still emits both. */
function closeEveryOpenToolCall(openToolCalls: Map<number, OpenToolCall>): ModelChunk[] {
  const chunks: ModelChunk[] = []
  for (const [index, open] of [...openToolCalls.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    openToolCalls.delete(index)
    chunks.push({
      type: 'toolCall',
      name: open.name,
      argsJson: open.argsJson === '' ? '{}' : open.argsJson,
    })
  }
  return chunks
}

function buildRequestBody(
  config: AnthropicProviderConfig,
  request: ChatRequest,
  tools: readonly ToolSchema[],
): string {
  const body: Record<string, unknown> = {
    model: config.modelId,
    max_tokens: request.maxOutputTokens ?? config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: renderContent(config, message.parts),
    })),
    stream: true,
  }
  if (request.system !== null && request.system !== '') body.system = request.system
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parametersJsonSchema,
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

function renderContent(
  config: AnthropicProviderConfig,
  parts: readonly ContentPart[],
): readonly Record<string, unknown>[] {
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
        type: 'image',
        source: { type: 'base64', media_type: part.mimeType, data: part.base64 },
      })
      continue
    }
    content.push({ type: 'text', text: `Result of ${part.toolName}:\n${part.content}` })
  }
  return content
}

function readBlockIndex(event: Record<string, unknown>): number {
  const index = event.index
  if (typeof index !== 'number') {
    throw new ModelCallError(
      '模型流的内容块事件没有携带 index，无法判断它在流中的位置。',
      { retryable: false, status: null },
    )
  }
  return index
}

async function readErrorBody(response: OutboundStream): Promise<string> {
  try {
    return await drainChunksAsText(response.chunks(), ERROR_BODY_CHAR_LIMIT)
  } catch {
    return ''
  }
}

function parseJsonFrame(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch (failure) {
    throw new ModelCallError(`模型流返回了不是合法 JSON 的帧：${describeThrown(failure)}`, {
      retryable: false,
      status: null,
    })
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
