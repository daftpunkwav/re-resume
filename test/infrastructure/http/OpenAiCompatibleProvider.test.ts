/**
 * @file OpenAiCompatibleProvider.test
 * @description The OpenAI chat-completions adapter: payload mapping for text,
 * images and tool results, streamed text and tool calls, usage frames, and the
 * failure classification. No socket is opened; the transport is scripted.
 */

import { describe, expect, it } from 'vitest'

import type { ChatRequest } from '../../../src/domain/generation/ports/ModelProvider'
import { DomainError } from '../../../src/domain/shared/DomainError'
import { OpenAiCompatibleProvider } from '../../../src/infrastructure/http/ProviderAdapters/OpenAiCompatibleProvider'
import { ModelCallError } from '../../../src/infrastructure/http/ProviderAdapters/errors'
import { collectChunks, scriptedHttpClient } from './fakeHttpClient'

const CONFIG = {
  id: 'provider-1',
  modelId: 'gpt-test',
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'sk-test-secret',
  supportsImages: true,
  maxOutputTokens: 4096,
}

function provider(http: ReturnType<typeof scriptedHttpClient>): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({ ...CONFIG, http })
}

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    system: '你是助手。',
    messages: [{ role: 'user', parts: [{ kind: 'text', text: '你好' }] }],
    ...overrides,
  }
}

function frame(payload: unknown): string {
  return JSON.stringify(payload)
}

describe('OpenAiCompatibleProvider', () => {
  it('sends system, messages, tools and the output ceiling', async () => {
    const http = scriptedHttpClient([{ events: ['[DONE]'] }])

    await collectChunks(
      provider(http).stream(
        request({ temperature: 0.2 }),
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
    expect(sent?.url).toBe('https://api.example.com/v1/chat/completions')
    expect(sent?.headers?.authorization).toBe('Bearer sk-test-secret')
    const body = http.lastBody()
    expect(body.model).toBe('gpt-test')
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(4096)
    expect(body.temperature).toBe(0.2)
    expect(body.messages).toEqual([
      { role: 'system', content: '你是助手。' },
      { role: 'user', content: '你好' },
    ])
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'searchInfoEntries',
          description: '检索信息条目',
          parameters: { type: 'object', properties: {} },
        },
      },
    ])
  })

  it('maps image parts to data URLs and tool results to text parts', async () => {
    const http = scriptedHttpClient([{ events: ['[DONE]'] }])
    const messages = [
      {
        role: 'user' as const,
        parts: [
          { kind: 'text' as const, text: '看这张图' },
          { kind: 'image' as const, mimeType: 'image/png', base64: 'aGVsbG8=' },
        ],
      },
      {
        role: 'user' as const,
        parts: [
          { kind: 'toolResult' as const, toolName: 'searchInfoEntries', content: '{"ok":true}' },
        ],
      },
    ]

    await collectChunks(provider(http).stream(request({ messages }), []))

    const body = http.lastBody()
    expect(body.messages).toEqual([
      { role: 'system', content: '你是助手。' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Result of searchInfoEntries:\n{"ok":true}' }],
      },
    ])
  })

  it('refuses an image part when the configuration cannot accept images', async () => {
    const http = scriptedHttpClient([{ events: ['[DONE]'] }])
    const textOnly = new OpenAiCompatibleProvider({ ...CONFIG, supportsImages: false, http })

    await expect(
      collectChunks(
        textOnly.stream(
          request({
            messages: [
              {
                role: 'user',
                parts: [{ kind: 'image', mimeType: 'image/png', base64: 'aGVsbG8=' }],
              },
            ],
          }),
          [],
        ),
      ),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('yields text deltas and usage', async () => {
    const http = scriptedHttpClient([
      {
        events: [
          frame({ choices: [{ delta: { content: '你' } }] }),
          frame({ choices: [{ delta: { content: '好' } }] }),
          frame({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
          '[DONE]',
        ],
      },
    ])

    await expect(collectChunks(provider(http).stream(request(), []))).resolves.toEqual([
      { type: 'text', textDelta: '你' },
      { type: 'text', textDelta: '好' },
      { type: 'usage', promptTokens: 12, completionTokens: 3 },
    ])
  })

  it('assembles a tool call from streamed fragments and emits it once finished', async () => {
    const http = scriptedHttpClient([
      {
        events: [
          frame({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { name: 'searchInfoEntries', arguments: '{"key' } },
                  ],
                },
              },
            ],
          }),
          frame({
            choices: [
              { delta: { tool_calls: [{ index: 0, function: { arguments: 'word":"前端"}' } }] } },
            ],
          }),
          frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
          '[DONE]',
        ],
      },
    ])

    await expect(collectChunks(provider(http).stream(request(), []))).resolves.toEqual([
      { type: 'toolCall', name: 'searchInfoEntries', argsJson: '{"keyword":"前端"}' },
    ])
  })

  it('hands over a tool call even when the stream ends without a finish reason', async () => {
    const http = scriptedHttpClient([
      {
        events: [
          frame({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { name: 'searchInfoEntries', arguments: '{}' } }],
                },
              },
            ],
          }),
        ],
      },
    ])

    await expect(collectChunks(provider(http).stream(request(), []))).resolves.toEqual([
      { type: 'toolCall', name: 'searchInfoEntries', argsJson: '{}' },
    ])
  })

  it('reports an error frame inside a 200 response', async () => {
    const http = scriptedHttpClient([{ events: [frame({ error: { message: 'content filtered' } })] }])

    await expect(collectChunks(provider(http).stream(request(), []))).rejects.toMatchObject({
      name: 'ModelCallError',
      retryable: false,
    })
  })

  it('reports a frame that is not valid JSON', async () => {
    const http = scriptedHttpClient([{ events: ['not json'] }])

    await expect(collectChunks(provider(http).stream(request(), []))).rejects.toBeInstanceOf(
      ModelCallError,
    )
  })

  it('classifies a 401 as a permanent failure and a 500 as retryable', async () => {
    const unauthorized = scriptedHttpClient([{ status: 401, body: 'bad key' }])
    await expect(collectChunks(provider(unauthorized).stream(request(), []))).rejects.toMatchObject({
      name: 'ModelCallError',
      status: 401,
      retryable: false,
    })

    const serverError = scriptedHttpClient([{ status: 500, body: 'boom' }])
    await expect(collectChunks(provider(serverError).stream(request(), []))).rejects.toMatchObject({
      name: 'ModelCallError',
      status: 500,
      retryable: true,
    })
  })

  it('does not retry a 429 that asks for a long wait', async () => {
    const http = scriptedHttpClient([
      { status: 429, headers: { 'retry-after': '30' }, body: 'slow down' },
    ])

    await expect(collectChunks(provider(http).stream(request(), []))).rejects.toMatchObject({
      name: 'ModelCallError',
      status: 429,
      retryable: false,
    })
  })

  it('returns without a chunk when the turn is aborted', async () => {
    const http = scriptedHttpClient([
      {
        events: [
          frame({ choices: [{ delta: { content: '你' } }] }),
          frame({ choices: [{ delta: { content: '好' } }] }),
        ],
      },
    ])
    const controller = new AbortController()
    const stream = provider(http).stream(request(), [], controller.signal)

    const chunks: unknown[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
      controller.abort()
    }
    expect(chunks).toEqual([{ type: 'text', textDelta: '你' }])
  })
})
