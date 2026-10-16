/**
 * @file OpenAiCompatibleProvider
 * @description The frames the OpenAI chat-completions wire format sends that
 * change what the run reports: an error inside a 200 response, and the
 * usage-only frame whose empty choices array is not an error at all.
 */

import { describe, expect, it } from 'vitest'
import { OpenAiCompatibleProvider } from '../../../src/infrastructure/http/ProviderAdapters/OpenAiCompatibleProvider'
import type { HttpClient, OutboundRequest, OutboundStream } from '../../../src/infrastructure/http/TauriHttpClient'
import type { ChatRequest, ModelChunk, ToolSchema } from '../../../src/domain/generation/ports/ModelProvider'

const REQUEST: ChatRequest = { system: null, messages: [{ role: 'user', text: '你好' }] }

/** Answers every request with the frames given, already framed as events. */
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
  const provider = new OpenAiCompatibleProvider({
    id: 'openai',
    modelId: 'gpt-test',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    http: clientServing(frames),
  })
  const tools: readonly ToolSchema[] = []
  const chunks: ModelChunk[] = []
  for await (const chunk of provider.stream(REQUEST, tools)) chunks.push(chunk)
  return chunks
}

describe('the OpenAI-compatible adapter', () => {
  it('reports an error the endpoint sent inside a 200 response', async () => {
    await expect(
      chunksFrom(['{"error":{"message":"模型已下线","type":"invalid_request_error"}}']),
    ).rejects.toThrow(/模型已下线/)
  })

  it('keeps a usage-only frame, whose choices array is empty, out of the error path', async () => {
    await expect(chunksFrom(['{"choices":[]}', '[DONE]'])).resolves.toEqual([])
  })

  it('delivers the text a normal frame carries', async () => {
    await expect(
      chunksFrom(['{"choices":[{"delta":{"content":"你好"}}]}', '[DONE]']),
    ).resolves.toEqual([{ type: 'text', textDelta: '你好' }])
  })
})
