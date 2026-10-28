/**
 * @file ModelProvider
 * @description Outbound model calls. Adding a vendor means adding an adapter;
 * nothing below this port knows which vendor it is talking to.
 *
 * Responsibilities:
 * - Declare the request, content-part and streamed-chunk shapes
 * - Declare the failure contract every adapter's errors satisfy, so the run
 *   loop can decide whether a failed turn may be retried without importing an
 *   infrastructure type
 *
 * Constraints:
 * - A message carries parts, not a text string: images and tool results need a
 *   structured carrier and the wire formats differ per vendor.
 * - `ChatMessage.role` is only user or assistant. A tool result is a part of
 *   the next user message; the adapters flatten it for their vendor.
 */

export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parametersJsonSchema: unknown
}

export interface ChatRequest {
  readonly system: string | null
  readonly messages: readonly ChatMessage[]
  readonly maxOutputTokens?: number
  readonly temperature?: number
}

export interface ChatMessage {
  readonly role: 'user' | 'assistant'
  readonly parts: readonly ContentPart[]
}

export type ContentPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly mimeType: string; readonly base64: string }
  | { readonly kind: 'toolResult'; readonly toolName: string; readonly content: string }

export type ModelChunk =
  | { readonly type: 'text'; readonly textDelta: string }
  | { readonly type: 'toolCall'; readonly name: string; readonly argsJson: string }
  | { readonly type: 'usage'; readonly promptTokens: number; readonly completionTokens: number }

export interface ModelProvider {
  readonly id: string
  readonly modelId: string
  /** Whether this configuration can accept image parts; the interface warns before sending. */
  readonly supportsImages: boolean
  /**
   * `signal` cancels a stream that is still running. Breaking out of the loop
   * that consumes the stream is not enough on its own: the connection stays
   * open until the adapter releases it, and an adapter can only do that when it
   * is handed a way to abort.
   */
  stream(
    request: ChatRequest,
    tools: readonly ToolSchema[],
    signal?: AbortSignal,
  ): AsyncIterable<ModelChunk>
}

/**
 * The failure fields a provider adapter's error carries. The retry policy lives
 * in the run loop; the classification (429/5xx/network/idle timeout versus a
 * caller error) lives in the adapter.
 */
export interface ModelCallFailure {
  readonly retryable: boolean
  readonly status: number | null
  readonly detail: string
}

/**
 * Reads the failure contract from an error without depending on the adapter's
 * class. Infrastructure owns the error type; the application layer only needs
 * the three facts above, and an unknown error is simply not retryable.
 */
export function readModelCallFailure(error: unknown): ModelCallFailure | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as { readonly retryable?: unknown; readonly status?: unknown; readonly detail?: unknown }
  if (typeof candidate.retryable !== 'boolean') return null
  return {
    retryable: candidate.retryable,
    status: typeof candidate.status === 'number' ? candidate.status : null,
    detail: typeof candidate.detail === 'string' ? candidate.detail : describeThrown(error),
  }
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
