/**
 * @file TauriHttpClient
 * @description Outbound HTTP through `@tauri-apps/plugin-http`, never the
 * WebView's own fetch: model endpoints are cross-origin, so the WebView's
 * same-origin policy and the CSP both stand in the way, and the plugin also
 * bypasses them by design. It additionally applies its own URL scope.
 *
 * Constraints:
 * - Only the plugin's own exports are used. In 2.8.3 the plugin exposes
 *   exactly one function, fetch(input, init) -> Response; its type file
 *   declares nothing else.
 * - Streaming is the seam for spec section 11. The shipped implementation does
 *   build a pull-driven ReadableStream over the response body (each pull reads
 *   one IPC chunk, and a trailing marker byte ends the stream), so
 *   readBodyChunks reads that stream directly. What is still unverified is
 *   whether the stream behaves identically on both target platforms; if it
 *   does not, only the adapters consuming `chunks()` change, and they fall
 *   back to reading the whole body.
 * - The request body is not streamed: the plugin buffers it with
 *   req.arrayBuffer() before sending. Outbound request bodies here are small
 *   JSON documents, so this is a note rather than a limitation.
 *
 * Responsibilities:
 * - Issue whole-body and streamed requests through the plugin
 * - Frame a response body as server-sent events, which both provider adapters
 *   speak and which belongs to the transport rather than to either vendor
 */

export type HttpMethod = 'GET' | 'POST'

export interface OutboundRequest {
  readonly method: HttpMethod
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  /** Rust-side connect timeout; the plugin takes it in milliseconds. */
  readonly connectTimeoutMs?: number
  readonly signal?: AbortSignal
}

export interface OutboundResponse {
  readonly status: number
  /** Resolves the whole body as text. */
  text(): Promise<string>
}

export interface OutboundStream {
  readonly status: number
  /** The response body as it arrives. */
  chunks(): AsyncIterable<Uint8Array>
  /**
   * The response body as server-sent event data payloads. Framing lives here
   * because both provider adapters speak SSE and the framing rules belong to
   * the transport, not to either vendor.
   */
  serverSentEvents(): AsyncIterable<string>
}

export interface HttpClient {
  send(request: OutboundRequest): Promise<OutboundResponse>
  openStream(request: OutboundRequest): Promise<OutboundStream>
}

/**
 * Type-only import: erased at compile time, so the plugin is still pulled in
 * lazily on first request rather than at module load.
 */
import type { fetch as tauriPluginFetch } from '@tauri-apps/plugin-http'

type TauriFetch = typeof tauriPluginFetch

let tauriFetchModule: Promise<TauriFetch> | null = null

export function createTauriHttpClient(): HttpClient {
  return new TauriHttpClient()
}

class TauriHttpClient implements HttpClient {
  async send(request: OutboundRequest): Promise<OutboundResponse> {
    const response = await this.#callPlugin(request)
    return {
      status: response.status,
      text: () => response.text(),
    }
  }

  async openStream(request: OutboundRequest): Promise<OutboundStream> {
    const response = await this.#callPlugin(request)
    return {
      status: response.status,
      chunks: () => readBodyChunks(response),
      serverSentEvents: () => readServerSentEvents(readBodyChunks(response)),
    }
  }

  async #callPlugin(request: OutboundRequest): Promise<Response> {
    const fetch = await resolveTauriFetch()
    // A fresh init object per call: the plugin deletes its own client options
    // from whatever object it is handed.
    return fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      body: request.body,
      signal: request.signal,
      connectTimeout: request.connectTimeoutMs,
    })
  }
}

/**
 * The plugin is imported on first use rather than at module load, so importing
 * this file outside the Tauri runtime does not pull the IPC bridge in.
 */
async function resolveTauriFetch(): Promise<TauriFetch> {
  tauriFetchModule ??= import('@tauri-apps/plugin-http').then((module) => module.fetch)
  return tauriFetchModule
}

async function* readBodyChunks(response: Response): AsyncIterable<Uint8Array> {
  const body = response.body
  if (body === null) {
    throw new Error(
      `The HTTP plugin returned status ${response.status} with no readable body, so it cannot be streamed. ` +
        'Statuses without a body by fetch specification are 101, 103, 204, 205 and 304.',
    )
  }
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value !== undefined) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Server-sent event framing: blank line dispatches the event, a leading colon
 * marks a comment, and several `data:` lines in one event join with a newline.
 * A frame left unterminated at end of stream is still dispatched, since a
 * provider that closes the connection mid-line should not lose that line.
 */
export async function* readServerSentEvents(
  chunks: AsyncIterable<Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder('utf-8')
  let pending = ''
  const dataLines: string[] = []
  for await (const chunk of chunks) {
    pending += decoder.decode(chunk, { stream: true })
    let lineEnd = pending.indexOf('\n')
    while (lineEnd !== -1) {
      const line = pending.slice(0, lineEnd).trim()
      pending = pending.slice(lineEnd + 1)
      const dispatched = dispatchServerSentEventLine(line, dataLines)
      if (dispatched !== null) yield dispatched
      lineEnd = pending.indexOf('\n')
    }
  }
  const trailing = pending.trim()
  if (trailing !== '') {
    const dispatched = dispatchServerSentEventLine(trailing, dataLines)
    if (dispatched !== null) yield dispatched
  }
  const dispatchedTail = flushServerSentEvent(dataLines)
  if (dispatchedTail !== null) yield dispatchedTail
}

function dispatchServerSentEventLine(line: string, dataLines: string[]): string | null {
  if (line === '') return flushServerSentEvent(dataLines)
  if (line.startsWith(':')) return null
  const colon = line.indexOf(':')
  const field = colon === -1 ? line : line.slice(0, colon)
  if (field !== 'data') return null
  const rawValue = colon === -1 ? '' : line.slice(colon + 1)
  dataLines.push(rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue)
  return null
}

function flushServerSentEvent(dataLines: string[]): string | null {
  if (dataLines.length === 0) return null
  const payload = dataLines.join('\n')
  // Cleared in place: the array belongs to the reader, and reassigning the
  // parameter here would leave every later event carrying this one's lines.
  dataLines.length = 0
  return payload
}

/**
 * Consumes a response body as text and truncates it. Used for failure
 * responses: the body is the only diagnostic a provider usually returns, and a
 * full HTML error page has no place in an exception message.
 */
export async function drainChunksAsText(
  chunks: AsyncIterable<Uint8Array>,
  maxChars: number,
): Promise<string> {
  const decoder = new TextDecoder('utf-8')
  let text = ''
  for await (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true })
    if (text.length > maxChars) break
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}
