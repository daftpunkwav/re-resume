/**
 * @file frames
 * @description The stream-frame vocabulary both provider adapters share: how an
 * error body is drained, how a server-sent frame is parsed, and how a JSON
 * value is held to the object shape the event mappings read.
 *
 * Responsibilities:
 * - Parse one server-sent frame or refuse it with a model-readable error
 * - Drain an error body without letting a transport failure replace the status
 *
 * Constraints:
 * - Every failure here is a `ModelCallError` marked non-retryable: a malformed
 *   frame says the stream itself is wrong, and re-issuing the call would be
 *   reading the same stream twice.
 */

import { drainChunksAsText } from '../TauriHttpClient'
import type { OutboundStream } from '../TauriHttpClient'
import { ERROR_BODY_CHAR_LIMIT, ModelCallError } from './errors'

/** Drains an error response body; the status is the diagnostic that matters. */
export async function readErrorBody(response: OutboundStream): Promise<string> {
  try {
    return await drainChunksAsText(response.chunks(), ERROR_BODY_CHAR_LIMIT)
  } catch {
    // An unreadable body is not allowed to replace the status with a
    // transport failure.
    return ''
  }
}

export function parseJsonFrame(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch (failure) {
    throw new ModelCallError(`模型流返回了不是合法 JSON 的帧：${describeThrown(failure)}`, {
      retryable: false,
      status: null,
    })
  }
}

export function requireRecord(value: unknown, what: string): Record<string, unknown> {
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
