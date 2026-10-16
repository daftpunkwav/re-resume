/**
 * @file DateTime
 * @description Branded calendar types. Both brands are obtainable only through
 * a parser or a Clock, so a malformed timestamp never enters the model.
 *
 * Constraints:
 * - DateTime is always UTC ISO 8601; display formatting belongs to the UI.
 */

import type { Brand } from './branded-id'

/** YYYY-MM-DD. Obtainable only via parseIsoDate; never hand-assembled. */
export type IsoDate = Brand<string, 'IsoDate'>

/** ISO 8601 UTC timestamp. Obtainable only via Clock or parseDateTime. */
export type DateTime = Brand<string, 'DateTime'>

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function parseIsoDate(raw: string): IsoDate | null {
  if (!ISO_DATE_PATTERN.test(raw)) return null
  // Rejects 2026-02-31 and friends, which the pattern alone would accept.
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === raw ? (raw as IsoDate) : null
}

export function parseDateTime(raw: string): DateTime | null {
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString() as DateTime
}

export function toIsoDate(value: DateTime): IsoDate {
  return value.slice(0, 10) as IsoDate
}

/** Truncates to milliseconds; SQLite stores TEXT timestamps at this precision. */
export function normalizeDateTime(value: DateTime): DateTime {
  return (new Date(value).toISOString().replace(/\.\d{3}Z$/, '.000Z')) as DateTime
}

export function compareDateTime(left: DateTime, right: DateTime): number {
  return left < right ? -1 : left > right ? 1 : 0
}
