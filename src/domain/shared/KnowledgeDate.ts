/**
 * @file KnowledgeDate
 * @description Month-precision calendar value for information records. A fact
 * such as "started in 2024" or "still ongoing" cannot be represented by a full
 * calendar date without inventing a day, so the model stores only the precision
 * it has.
 *
 * Responsibilities:
 * - Parse the canonical text forms `YYYY-MM`, `YYYY` and `present`
 * - Format a value for display without re-deriving the precision
 * - Order values so callers can compare them without parsing again
 *
 * Constraints:
 * - `present` is lowercase only, and it is a value rather than a flag: a record
 *   that ended in the future must be distinguishable from one that is ongoing.
 * - A parse failure returns null rather than throwing: field validation decides
 *   which error code a malformed value becomes.
 * - This module is pure: no DOM, no storage, no package.
 */

import type { Brand } from './branded-id'

/** Canonical text: `YYYY-MM` | `YYYY` | `present`. */
export type KnowledgeDate = Brand<string, 'KnowledgeDate'>

/** Sort key of `present`; later than any real calendar date in range. */
const PRESENT_SORT_KEY = 999_912

const MIN_YEAR = 1900
const MAX_YEAR = 2100
const MONTHS_PER_YEAR = 12

const CALENDAR_PATTERN = /^(\d{4})(?:-(\d{2}))?$/

/** The ongoing value used as an end date. */
export const PRESENT: KnowledgeDate = 'present' as KnowledgeDate

/**
 * Reads a canonical knowledge date, or returns null for anything else.
 *
 * The parser is strict on purpose: leading/trailing whitespace, a January
 * written as a full date or an upper-case `Present` are all rejected, so stored
 * values and field values share one spelling.
 */
export function parseKnowledgeDate(raw: string): KnowledgeDate | null {
  if (raw === PRESENT) return PRESENT
  const match = CALENDAR_PATTERN.exec(raw)
  if (match === null) return null
  const year = Number(match[1])
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  const monthText = match[2]
  if (monthText === undefined) return year.toString() as KnowledgeDate
  const month = Number(monthText)
  if (month < 1 || month > MONTHS_PER_YEAR) return null
  return `${year.toString()}-${monthText}` as KnowledgeDate
}

/** Display form: `2024 年 6 月`, `2024 年`, or `至今`. */
export function formatKnowledgeDate(date: KnowledgeDate): string {
  if (date === PRESENT) return '至今'
  const separator = date.indexOf('-')
  if (separator === -1) return `${date} 年`
  return `${date.slice(0, separator)} 年 ${Number(date.slice(separator + 1))} 月`
}

/**
 * Numeric ordering key: `year * 100 + month`, with a year-only value counted as
 * January. `present` gets the largest key, so `end >= start` holds for every
 * completed or ongoing range.
 */
export function knowledgeDateSortKey(date: KnowledgeDate): number {
  if (date === PRESENT) return PRESENT_SORT_KEY
  const separator = date.indexOf('-')
  if (separator === -1) return Number(date) * 100 + 1
  return Number(date.slice(0, separator)) * 100 + Number(date.slice(separator + 1))
}

/** Orders two knowledge dates; negative when `left` is earlier. */
export function compareKnowledgeDate(left: KnowledgeDate, right: KnowledgeDate): number {
  return knowledgeDateSortKey(left) - knowledgeDateSortKey(right)
}
