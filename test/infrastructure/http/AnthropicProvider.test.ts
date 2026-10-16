/**
 * @file AnthropicProvider
 * @description The block protocol the messages wire format uses: a tool call
 * opens with a content block, accumulates argument fragments, and closes with
 * content_block_stop. The port speaks whole calls, so the test drives the four
 * events a call needs and what the port hands back.
 */

import { describe, expect, it } from 'vitest'
import { AnthropicProvider } from '../../../src/infrastructure/http/ProviderAdapters/AnthropicProvider'
import type { HttpClient, OutboundRequest, OutboundStream } from '../../../src/infrastructure/http/TauriHttpClient'
import type { ChatRequest, ModelChunk, ToolSchema } from '../../../src/domain/generation/ports/ModelProvider'

const REQUEST: ChatRequest = { system: null, messages: [{ role: 'user', text: '你好' }] }

function clientServing(frames: readonly string[]): HttpClient {
  async function* noBody(): AsyncIterable<Uint8Array> {}
  async function* events(): AsyncIterable<string> {
    yield* frames
  }
  const stream: OutboundStream = {
    status: 200,
    chunks: () => noBody(),
    serverSentEvents: () => events(),
  }
  return {
    send: async () => ({ status: 200, text: async () => '' }),
    openStream: async (_request: OutboundRequest) => stream,
  }
}

async function chunksFrom(frames: readonly string[]): Promise<readonly ModelChunk[]> {
  const provider = new AnthropicProvider({
    id: 'anthropic',
    modelId: 'claude-test',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-test',
    http: clientServing(frames),
  })
  const tools: readonly ToolSchema[] = []
  const chunks: ModelChunk[] = []
  for await (const chunk of provider.stream(REQUEST, tools)) chunks.push(chunk)
  return chunks
}

function frame(event: unknown): string {
  return JSON.stringify(event)
}

describe('the Anthropic adapter', () => {
  it('delivers the text a delta carries and skips an empty one', async () => {
    await expect(
      chunksFrom([
        frame({ type: 'message_start' }),
        frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } }),
        frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '' } }),
      ]),
    ).resolves.toEqual([{ type: 'text', textDelta: '你好' }])
  })

  it('emits one tool call with its fragments joined, when the block closes', async () => {
    await expect(
      chunksFrom([
        frame({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'searchExperiences' },
        }),
        frame({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"keyword":' },
        }),
        frame({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"支付"}' },
        }),
        frame({ type: 'content_block_stop', index: 1 }),
      ]),
    ).resolves.toEqual([
      { type: 'toolCall', name: 'searchExperiences', argsJson: '{"keyword":"支付"}' },
    ])
  })

  it('hands over a call the stream left open rather than losing it', async () => {
    await expect(
      chunksFrom([
        frame({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'createResumeDraft' },
        }),
        frame({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"jobPostingId":"p1"}' },
        }),
      ]),
    ).resolves.toEqual([
      { type: 'toolCall', name: 'createResumeDraft', argsJson: '{"jobPostingId":"p1"}' },
    ])
  })

  it('reports an error the endpoint sent inside the stream', async () => {
    await expect(
      chunksFrom([frame({ type: 'error', error: { message: '模型已下线' } })]),
    ).rejects.toThrow(/模型已下线/)
  })

  it('refuses argument fragments for a block it never saw opened', async () => {
    await expect(
      chunksFrom([
        frame({
          type: 'content_block_delta',
          index: 3,
          delta: { type: 'input_json_delta', partial_json: '{}' },
        }),
      ]),
    ).rejects.toThrow(/without opening a tool_use block/)
  })
})
