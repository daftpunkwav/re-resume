/**
 * @file errors
 * @description Failure taxonomy of the provider adapters. Every failure the
 * model call can produce leaves the adapter as a ModelCallError carrying the
 * three facts the retry policy needs: whether the attempt may be retried, the
 * HTTP status when there was one, and a redacted diagnostic.
 *
 * Responsibilities:
 * - Turn an HTTP status, a provider error payload or a transport throw into one
 *   error type
 * - Encode the retryable set of the technical contract
 * - Truncate diagnostics and never reproduce a credential
 *
 * Constraints:
 * - This module must not read the API key; the adapters hand in an already
 *   composed message and a body that is diagnostic only.
 * - 429 is retryable only when the provider asks to wait five seconds or less:
 *   a longer wait is the user's decision, not an automatic one.
 */

/** Longest provider error body reproduced in a message. */
export const ERROR_BODY_CHAR_LIMIT = 600

/** Retry-after values above this many seconds are reported, not retried. */
export const RETRY_AFTER_LIMIT_SECONDS = 5

export class ModelCallError extends Error {
  readonly retryable: boolean
  readonly status: number | null
  readonly detail: string

  constructor(
    detail: string,
    options: { readonly retryable: boolean; readonly status: number | null },
  ) {
    super(detail)
    this.name = 'ModelCallError'
    this.retryable = options.retryable
    this.status = options.status
    this.detail = truncateDetail(detail)
  }
}

/**
 * 429, 500, 502, 503 and 504 are worth another attempt; every other status is a
 * caller-side problem (bad key, unknown model, malformed body) or a permanent
 * refusal.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

/**
 * Builds the error for a non-success response. `retryAfterSeconds` is read from
 * the `retry-after` header; a long wait turns a 429 into a user decision.
 */
export function modelCallErrorForStatus(
  endpoint: string,
  status: number,
  body: string,
  retryAfterSeconds: number | null,
): ModelCallError {
  const retryableByStatus = isRetryableStatus(status)
  const longRetryAfter =
    status === 429 && retryAfterSeconds !== null && retryAfterSeconds > RETRY_AFTER_LIMIT_SECONDS
  const waitHint =
    status === 429 && retryAfterSeconds !== null
      ? `（服务商建议等待 ${retryAfterSeconds} 秒后再试）`
      : ''
  const retryable = retryableByStatus && !longRetryAfter
  return new ModelCallError(
    `${endpoint} 返回 ${status}${waitHint}：${truncateDetail(body)}`,
    { retryable, status },
  )
}

/**
 * Classifies a thrown transport error. A user abort is not retried; any other
 * transport failure is a network interruption and is worth one retry.
 */
export function modelCallErrorForThrown(endpoint: string, error: unknown): ModelCallError {
  const aborted =
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { readonly reason?: unknown }).reason !== undefined)
  const detail = describeThrown(error)
  return new ModelCallError(`${endpoint} 请求失败${aborted ? '（已中止）' : ''}：${detail}`, {
    retryable: !aborted,
    status: null,
  })
}

/** Reads the retry-after header, accepting seconds or an HTTP date. */
export function readRetryAfterSeconds(headers: Readonly<Record<string, string>>): number | null {
  const raw = headers['retry-after']
  if (raw === undefined || raw.trim() === '') return null
  const seconds = Number.parseInt(raw.trim(), 10)
  if (Number.isFinite(seconds) && seconds >= 0 && `${seconds}` === raw.trim()) return seconds
  // A decimal number is a malformed seconds value, not a date; the HTTP-date
  // form always names a month or a time zone, so it contains a letter.
  if (!/[a-z]/iu.test(raw)) return null
  const date = Date.parse(raw)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

export function truncateDetail(text: string): string {
  const trimmed = text.trim()
  const codePoints = [...trimmed]
  if (codePoints.length <= ERROR_BODY_CHAR_LIMIT) return trimmed
  return `${codePoints.slice(0, ERROR_BODY_CHAR_LIMIT - 1).join('')}…`
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
