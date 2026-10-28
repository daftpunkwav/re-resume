/**
 * @file AnthropicProvider.test
 * @description The Anthropic messages adapter: payload mapping for text, images
 * and tool results, the block protocol for text and tool_use, the split usage
 * frames, and the failure classification. The transport is scripted.
 */

import { describe, expect, it } from 'vitest'

import type { ChatRequest } from '../../../src/domain/generation/ports/ModelProvider'
import { AnthropicProvider } from '../../../src/infrastructure/http/ProviderAdapters/AnthropicProvider'
import { ModelCallError } from '../../../src/infrastructure/http/ProviderAdapters/errors'
import { collectChunks, scriptedHttpClient } from './fakeHttpClient'

const CONFIG = {
  id: 'provider-1',
  modelId: 'claude-test',
  baseUrl: 'https://api.anthropic.com/',
  apiKey: 'sk-ant-test',
  supportsImages: true,
}

function provider(http: ReturnType<typeof scriptedHttpClient>): AnthropicProvider {
  return new AnthropicProvider({ ...CONFIG, http })
}

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    system: '你是助手。',
    messages: [{ role: 'user', parts: [{ kind: 'text', text: '你好' }] }],
    ...overrides,
  }
}

function event(payload: unknown): string {
  return JSON.stringify(payload)
}

describe('AnthropicProvider', () => {
  it('sends system at the top level, max_tokens and tools', async () => {
    const http = scriptedHttpClient([{ events: [] }])

    await collectChunks(
      provider(http).stream(
        request({ maxOutputTokens: 1024, temperature: 0.3 }),
        [
          {
            name: 'searchInfoEntries',
            description: '检索信息条目',
            parametersJsonSchema: { type: 'object', properties: {} },
          },
        ],
      ),
    )

    const sent = http.requests[0]
    expect(sent?.url).toBe('https://api.anthropic.com/v1/messages')
    expect(sent?.headers?.['x-api-key']).toBe('sk-ant-test')
    expect(sent?.headers?.['anthropic-version']).toBe('2023-06-01')
    const body = http.lastBody()
    expect(body.model).toBe('claude-test')
    expect(body.max_tokens).toBe(1024)
    expect(body.temperature).toBe(0.3)
    expect(body.system).toBe('你是助手。')
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
    ])
    expect(body.tools).toEqual([
      {
        name: 'searchInfoEntries',
        description: '检索信息条目',
        input_schema: { type: 'object', properties: {} },
      },
    ])
  })

  it('defaults max_tokens to the wire format value when nothing sets it', async () => {
    const http = scriptedHttpClient([{ events: [] }])
    await collectChunks(provider(http).stream(request(), []))
    expect(http.lastBody().max_tokens).toBe(4096)
  })

  it('maps image parts to base64 sources and tool results to text blocks', async () => {
    const http = scriptedHttpClient([{ events: [] }])
    await collectChunks(
      provider(http).stream(
        request({
          messages: [
            {
              role: 'user',
              parts: [
                { kind: 'text', text: '看图' },
                { kind: 'image', mimeType: 'image/jpeg', base64: 'aGVsbG8=' },
              ],
            },
            {
              role: 'user',
              parts: [
                { kind: 'toolResult', toolName: 'searchInfoEntries', content: '{"ok":true}' },
              ],
            },
          ],
        }),
        [],
      ),
    )

    expect(http.lastBody().messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '看图' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' },
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Result of searchInfoEntries:\n{"ok":true}' }],
      },
    ])
  })

  it('yields text deltas and the combined usage', async () => {
    const http = scriptedHttpClient([
      {
        events: [
          event({ type: 'message_start', message: { usage: { input_tokens: 20 } } }),
          event({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
          event({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '你' },
          }),
          event({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '好' },
          }),
          event({ type: 'content_block_stop', index: 0 }),
          event({ type: 'message_delta', usage: { output_tokens: 5 } }),
          event({ type: 'message_stop' }),
        ],
      },
    ])

    await expect(collectChunks(provider(http).stream(request(), []))).resolves.toEqual([
      { type: 'text', textDelta: '你' },
      { type: 'text', textDelta: '好' },
      { type: 'usage', promptTokens: 20, completionTokens: 5 },
    ])
  })

  it('assembles a tool_use block from its argument fragments', async () => {
    const http = scriptedHttpClient([
      {
        events: [
          event({
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', name: 'searchInfoEntries' },
          }),
          event({
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"key' },
          }),
          event({
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: 'word":"前端"}' },
          }),
          event({ type: 'content_block_stop', index: 1 }),
          event({ type: 'message_stop' }),
        ],
      },
    ])

    await expect(collectChunks(provider(http).stream(request(), []))).resolves.toEqual([
      { type: 'toolCall', name: 'searchInfoEntries', argsJson: '{"keyword":"前端"}' },
    ])
  })

  it('hands over a tool call the stream never closed', async () => {
    const http = scriptedHttpClient([
      {
        events: [
          event({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', name: 'listResumes' },
          }),
        ],
      },
    ])

    await expect(collectChunks(provider(http).stream(request(), []))).resolves.toEqual([
      { type: 'toolCall', name: 'listResumes', argsJson: '{}' },
    ])
  })

  it('reports an error event', async () => {
    const http = scriptedHttpClient([
      { events: [event({ type: 'error', error: { type: 'overloaded_error' } })] },
    ])

    await expect(collectChunks(provider(http).stream(request(), []))).rejects.toBeInstanceOf(
      ModelCallError,
    )
  })

  it('classifies a 403 as permanent and a 503 as retryable', async () => {
    const forbidden = scriptedHttpClient([{ status: 403, body: 'forbidden' }])
    await expect(collectChunks(provider(forbidden).stream(request(), []))).rejects.toMatchObject({
      name: 'ModelCallError',
      status: 403,
      retryable: false,
    })

    const unavailable = scriptedHttpClient([{ status: 503, body: 'busy' }])
    await expect(collectChunks(provider(unavailable).stream(request(), []))).rejects.toMatchObject({
      name: 'ModelCallError',
      status: 503,
      retryable: true,
    })
  })

  it('returns without a chunk when the turn is aborted', async () => {
    const http = scriptedHttpClient([
      {
        events: [
          event({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '你' },
          }),
          event({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '好' },
          }),
        ],
      },
    ])
    const controller = new AbortController()
    const chunks: unknown[] = []
    for await (const chunk of provider(http).stream(request(), [], controller.signal)) {
      chunks.push(chunk)
      controller.abort()
    }
    expect(chunks).toEqual([{ type: 'text', textDelta: '你' }])
  })
})
