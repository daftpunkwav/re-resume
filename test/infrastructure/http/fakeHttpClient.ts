/**
 * @file fakeHttpClient
 * @description A scripted HTTP client for the provider adapter tests. It
 * records the outbound request and replays server-sent event payloads, so an
 * adapter can be exercised end to end without a socket.
 */

import type {
  HttpClient,
  OutboundRequest,
  OutboundResponse,
  OutboundStream,
} from '../../../src/infrastructure/http/TauriHttpClient'

export interface ScriptedResponse {
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
  readonly events?: readonly string[]
  readonly body?: string
}

export interface ScriptedHttpClient extends HttpClient {
  readonly requests: OutboundRequest[]
  /** The request body of the last call, decoded. */
  lastBody(): Record<string, unknown>
}

export function scriptedHttpClient(responses: readonly ScriptedResponse[]): ScriptedHttpClient {
  const requests: OutboundRequest[] = []
  let call = 0
  const next = (): ScriptedResponse => {
    const response = responses[call] ?? responses[responses.length - 1]
    call += 1
    if (response === undefined) throw new Error('The fake HTTP client received an unexpected call.')
    return response
  }
  const openStream = async (request: OutboundRequest): Promise<OutboundStream> => {
    requests.push(request)
    const response = next()
    const events = response.events ?? []
    const body = response.body ?? ''
    return {
      status: response.status ?? 200,
      headers: response.headers ?? {},
      chunks: async function* () {
        if (body !== '') yield new TextEncoder().encode(body)
      },
      serverSentEvents: async function* () {
        for (const event of events) yield event
      },
    }
  }
  return {
    requests,
    lastBody: () => {
      const last = requests.at(-1)
      if (last?.body === undefined) return {}
      return JSON.parse(last.body) as Record<string, unknown>
    },
    send: async (request: OutboundRequest): Promise<OutboundResponse> => {
      requests.push(request)
      const response = next()
      return {
        status: response.status ?? 200,
        headers: response.headers ?? {},
        text: async () => response.body ?? '',
      }
    },
    openStream,
  }
}

/** Collects a provider stream, so a test can assert on the chunk list. */
export async function collectChunks<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
