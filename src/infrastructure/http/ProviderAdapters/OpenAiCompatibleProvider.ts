/**
 * @file OpenAiCompatibleProvider
 * @description ModelProvider adapter for the OpenAI chat-completions wire
 * format, which serves OpenAI itself and the vendors that reproduce it. The
 * port speaks whole chunks of text and tool calls; this file is the only place
 * that knows about `choices[].delta`, `finish_reason` and the `[DONE]`
 * sentinel.
 *
 * Constraints:
 * - A streamed tool call arrives as argument fragments keyed by index, and the
 *   name arrives only on the first fragment. Fragments are therefore
 *   accumulated per index and emitted as one ModelChunk when the call
 *   completes — emitting a partial argsJson would hand the tool registry
 *   unparsable arguments.
 * - Stream payloads are read defensively: a frame that is not JSON, or that
 *   lacks the fields it is supposed to carry, is reported rather than skipped,
 *   because a silently dropped tool call looks exactly like a model that chose
 *   not to call a tool.
 * - The API key is supplied by the composition root from the SecretStore. It
 *   travels in the Authorization header and never appears in an error message.
 */

import type { ChatRequest, ModelChunk, ModelProvider, ToolSchema } from '../../../domain/generation/ports/ModelProvider'
import { drainChunksAsText } from '../TauriHttpClient'
import type { HttpClient, OutboundStream } from '../TauriHttpClient'

const COMPLETIONS_PATH = '/chat/completions'
const STREAM_SENTINEL = '[DONE]'
/** An error body is diagnostic, not documentation; a long page helps nobody. */
const ERROR_BODY_CHAR_LIMIT = 600

export interface OpenAiCompatibleProviderConfig {
  /** Provider identity used by the tool run records. */
  readonly id: string
  readonly modelId: string
  /** Endpoint root, for example https://api.openai.com/v1. */
  readonly baseUrl: string
  /** Loaded from the SecretStore by the composition root. */
  readonly apiKey: string
  readonly http: HttpClient
  readonly connectTimeoutMs?: number
}

interface PendingToolCall {
  name: string
  argsJson: string
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly id: string
  readonly modelId: string
  readonly #config: OpenAiCompatibleProviderConfig

  constructor(config: OpenAiCompatibleProviderConfig) {
    this.#config = config
    this.id = config.id
    this.modelId = config.modelId
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
  const response = await config.http.openStream({
    method: 'POST',
    url: `${config.baseUrl.replace(/\/+$/, '')}${COMPLETIONS_PATH}`,
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(config.modelId, request, tools)),
    connectTimeoutMs: config.connectTimeoutMs,
    signal,
  })
  await refuseUnsuccessfulResponse('OpenAI-compatible endpoint', response)

  const pendingToolCalls = new Map<number, PendingToolCall>()
  for await (const data of response.serverSentEvents()) {
    if (data === STREAM_SENTINEL) break
    const delta = readDelta(data)
    const content = delta.content
    if (typeof content === 'string' && content.length > 0) {
      yield { type: 'text', textDelta: content }
    }
    accumulateToolCallFragments(pendingToolCalls, delta.toolCalls)
    if (delta.finishReason === 'tool_calls') {
      yield* emitPendingToolCalls(pendingToolCalls)
    }
  }
  // A stream that ends without a tool_calls finish reason still has to hand
  // over whatever it assembled.
  yield* emitPendingToolCalls(pendingToolCalls)
}

interface StreamDelta {
  readonly content?: unknown
  readonly finishReason?: unknown
  readonly toolCalls: readonly unknown[]
}

function readDelta(data: string): StreamDelta {
  const payload = requireRecord(parseJsonFrame(data), 'stream frame')
  // An error is reported inside a 200 response, and it carries no choices.
  // Falling through to the empty-delta branch would turn a provider failure
  // into a turn that simply said nothing, which the loop reports as completed.
  if (payload.error !== undefined && payload.error !== null) {
    throw new Error(
      `The stream reported an error: ${JSON.stringify(payload.error)}`,
    )
  }
  const choices = payload.choices
  // An empty choices array is how a usage-only frame arrives; that is not an
  // error, and the frame is simply skipped.
  if (!Array.isArray(choices)) return { toolCalls: [] }
  const choice = choices[0]
  if (choice === null || typeof choice !== 'object' || Array.isArray(choice)) {
    return { toolCalls: [] }
  }
  const choiceRecord = choice as Record<string, unknown>
  const delta = choiceRecord.delta
  const deltaRecord =
    delta === null || typeof delta !== 'object' || Array.isArray(delta)
      ? {}
      : (delta as Record<string, unknown>)
  return {
    content: deltaRecord.content,
    finishReason: choiceRecord.finish_reason,
    toolCalls: Array.isArray(deltaRecord.tool_calls) ? deltaRecord.tool_calls : [],
  }
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
      throw new Error(
        `The model streamed a tool call at index ${index} without ever naming it, so it cannot be dispatched. ` +
          `Its arguments were ${JSON.stringify(call.argsJson)}.`,
      )
    }
    yield { type: 'toolCall', name: call.name, argsJson: call.argsJson }
  }
}

function buildRequestBody(
  modelId: string,
  request: ChatRequest,
  tools: readonly ToolSchema[],
): Record<string, unknown> {
  const messages: Record<string, string>[] = []
  if (request.system !== null) messages.push({ role: 'system', content: request.system })
  for (const message of request.messages) {
    messages.push({ role: message.role, content: message.text })
  }
  const body: Record<string, unknown> = { model: modelId, messages, stream: true }
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
  return body
}

async function refuseUnsuccessfulResponse(
  endpoint: string,
  response: OutboundStream,
): Promise<void> {
  if (response.status >= 200 && response.status < 300) return
  const body = await drainChunksAsText(response.chunks(), ERROR_BODY_CHAR_LIMIT)
  throw new Error(`${endpoint} responded ${response.status}: ${body}`)
}

function parseJsonFrame(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch (error) {
    throw new Error(`The stream carried a frame that is not valid JSON: ${data}`, { cause: error })
  }
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected the ${what} to be a JSON object.`)
  }
  return value as Record<string, unknown>
}
