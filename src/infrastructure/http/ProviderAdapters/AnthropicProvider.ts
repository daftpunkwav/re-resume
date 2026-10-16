/**
 * @file AnthropicProvider
 * @description ModelProvider adapter for Anthropic's messages wire format.
 * The port speaks whole chunks of text and tool calls; this file is the only
 * place that knows about `content_block_start`, the text and input-json delta
 * types, and the `anthropic-version` header.
 *
 * Constraints:
 * - Anthropic separates block kinds: a tool call opens with a content_block
 *   carrying its id and name, accumulates `input_json_delta` fragments, and
 *   closes with content_block_stop. The accumulated JSON is emitted at the
 *   close, so the registry never sees partial arguments.
 * - max_tokens is required by the wire format and has no domain default, so it
 *   is part of the configuration rather than a hidden constant here.
 * - The API key is supplied by the composition root from the SecretStore and
 *   travels in the x-api-key header; it never appears in an error message.
 */

import type { ChatRequest, ModelChunk, ModelProvider, ToolSchema } from '../../../domain/generation/ports/ModelProvider'
import { drainChunksAsText } from '../TauriHttpClient'
import type { HttpClient, OutboundStream } from '../TauriHttpClient'

const MESSAGES_PATH = '/v1/messages'
const API_VERSION = '2023-06-01'
const ERROR_BODY_CHAR_LIMIT = 600
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
  readonly maxOutputTokens?: number
  readonly connectTimeoutMs?: number
}

interface OpenToolCall {
  readonly name: string
  argsJson: string
}

export class AnthropicProvider implements ModelProvider {
  readonly id: string
  readonly modelId: string
  readonly #config: AnthropicProviderConfig

  constructor(config: AnthropicProviderConfig) {
    this.#config = config
    this.id = config.id
    this.modelId = config.modelId
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
  const response = await config.http.openStream({
    method: 'POST',
    url: `${config.baseUrl.replace(/\/+$/, '')}${MESSAGES_PATH}`,
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-api-key': config.apiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify(
      buildRequestBody(config.modelId, config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, request, tools),
    ),
    connectTimeoutMs: config.connectTimeoutMs,
    signal,
  })
  await refuseUnsuccessfulResponse('Anthropic messages endpoint', response)

  const openToolCalls = new Map<number, OpenToolCall>()
  for await (const data of response.serverSentEvents()) {
    const event = requireRecord(parseJsonFrame(data), 'stream event')
    const type = event.type
    if (type === 'content_block_delta') {
      const delta = requireRecord(event.delta, 'content_block_delta.delta')
      if (delta.type === 'text_delta') {
        const text = delta.text
        if (typeof text === 'string' && text !== '') yield { type: 'text', textDelta: text }
      } else if (delta.type === 'input_json_delta') {
        const partial = delta.partial_json
        const index = readBlockIndex(event)
        const open = openToolCalls.get(index)
        if (open === undefined) {
          throw new Error(
            `The stream sent argument fragments for content block ${index} without opening a tool_use block for it.`,
          )
        }
        if (typeof partial === 'string') open.argsJson += partial
      }
      continue
    }
    if (type === 'content_block_start') {
      const block = requireRecord(event.content_block, 'content_block_start.content_block')
      if (block.type === 'tool_use') {
        const name = block.name
        if (typeof name !== 'string' || name === '') {
          throw new Error('The stream opened a tool_use block without naming the tool.')
        }
        openToolCalls.set(readBlockIndex(event), { name, argsJson: '' })
      }
      continue
    }
    if (type === 'content_block_stop') {
      const index = readBlockIndex(event)
      const open = openToolCalls.get(index)
      if (open === undefined) continue
      openToolCalls.delete(index)
      yield { type: 'toolCall', name: open.name, argsJson: open.argsJson }
      continue
    }
    if (type === 'error') {
      throw new Error(`The stream reported an error: ${JSON.stringify(event.error)}`)
    }
  }
  // A stream cut short after the last fragment still has to hand over what it
  // assembled rather than losing the call.
  for (const [index, open] of [...openToolCalls.entries()].sort(([left], [right]) => left - right)) {
    openToolCalls.delete(index)
    yield { type: 'toolCall', name: open.name, argsJson: open.argsJson }
  }
}

function buildRequestBody(
  modelId: string,
  maxOutputTokens: number,
  request: ChatRequest,
  tools: readonly ToolSchema[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: maxOutputTokens,
    messages: request.messages.map((message) => ({ role: message.role, content: message.text })),
    stream: true,
  }
  if (request.system !== null) body.system = request.system
  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parametersJsonSchema,
    }))
  }
  return body
}

function readBlockIndex(event: Record<string, unknown>): number {
  const index = event.index
  if (typeof index !== 'number') {
    throw new Error('A content block event arrived without an index, so its stream position is unknown.')
  }
  return index
}

async function refuseUnsuccessfulResponse(endpoint: string, response: OutboundStream): Promise<void> {
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
