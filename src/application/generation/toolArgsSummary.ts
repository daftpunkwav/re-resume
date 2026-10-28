/**
 * @file toolArgsSummary
 * @description Renders the short argument preview a tool card shows before the
 * model's call has been executed. The preview is a summary, not the call: long
 * strings and long arrays are folded, and every credential is scrubbed.
 *
 * Constraints:
 * - The output is at most 400 characters and has passed through the secret
 *   scrubber after the JSON document was decoded, so a credential written with
 *   JSON escapes cannot survive.
 */

import { redactJsonSecrets, redactSecret } from './redactSecret'

/** Longest summary rendered on a tool card. */
export const TOOL_ARGS_SUMMARY_MAX_LENGTH = 400

const STRING_PREVIEW_LENGTH = 120
const ARRAY_PREVIEW_LENGTH = 5
const MAX_DEPTH = 3

export function summarizeToolArgs(argsJson: string, secrets: readonly string[]): string {
  const redactedJson = redactJsonSecrets(argsJson, secrets)
  let decoded: unknown
  try {
    decoded = JSON.parse(redactedJson) as unknown
  } catch {
    return truncate(redactSecret(argsJson, secrets), TOOL_ARGS_SUMMARY_MAX_LENGTH)
  }
  const compact = JSON.stringify(fold(decoded, 0), null, 0) ?? ''
  return truncate(redactSecret(compact, secrets), TOOL_ARGS_SUMMARY_MAX_LENGTH)
}

function fold(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length <= STRING_PREVIEW_LENGTH
      ? value
      : `${value.slice(0, STRING_PREVIEW_LENGTH)}…`
  }
  if (Array.isArray(value)) {
    const head = value.slice(0, ARRAY_PREVIEW_LENGTH).map((entry) => fold(entry, depth + 1))
    return value.length > ARRAY_PREVIEW_LENGTH ? [...head, `…共 ${value.length} 项`] : head
  }
  if (value !== null && typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '（嵌套内容已折叠）'
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        fold(entry, depth + 1),
      ]),
    )
  }
  return value
}

function truncate(text: string, limit: number): string {
  const codePoints = [...text]
  return codePoints.length <= limit ? text : `${codePoints.slice(0, limit - 1).join('')}…`
}
