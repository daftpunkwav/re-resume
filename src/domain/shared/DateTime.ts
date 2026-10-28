/**
 * @file DateTime
 * @description Branded calendar type. A DateTime is obtainable only through a
 * parser or a Clock, so a malformed timestamp never enters the model.
 *
 * Constraints:
 * - DateTime is always UTC ISO 8601; display formatting belongs to the UI.
 */

import type { Brand } from './branded-id'

/** ISO 8601 UTC timestamp. Obtainable only via Clock or parseDateTime. */
export type DateTime = Brand<string, 'DateTime'>

export function parseDateTime(raw: string): DateTime | null {
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString() as DateTime
}

/** Truncates to milliseconds; SQLite stores TEXT timestamps at this precision. */
export function normalizeDateTime(value: DateTime): DateTime {
  return (new Date(value).toISOString().replace(/\.\d{3}Z$/, '.000Z')) as DateTime
}

export function compareDateTime(left: DateTime, right: DateTime): number {
  return left < right ? -1 : left > right ? 1 : 0
}
