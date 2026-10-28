/**
 * @file rowContract
 * @description Column readers shared by the information-library row mappers.
 * Each reader either returns the value the column contract promises or throws
 * `RowMappingError`; a stored row this build cannot interpret is reported, never
 * coerced into a plausible default.
 *
 * Constraints:
 * - Only the three information-library mappers use these helpers: they are
 *   written against the plain column/value contract, not against a specific
 *   table.
 * - Nullability is explicit: a `required*` reader rejects NULL, an `optional*`
 *   reader returns null for it.
 */

import type { DateTime } from '../../../../domain/shared/DateTime'
import { parseDateTime } from '../../../../domain/shared/DateTime'
import { readJsonArrayEnvelope, readJsonRecordEnvelope, RowMappingError } from '../../JsonEnvelope'

/** A row as the dialect returns it: column name to a value of unknown type. */
export interface Row {
  readonly [column: string]: unknown
}

export function requiredString(row: Row, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') {
    throw new RowMappingError(column, 'expected text', value)
  }
  return value
}

export function optionalString(row: Row, column: string): string | null {
  const value = row[column]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new RowMappingError(column, 'expected text or NULL', value)
  }
  return value
}

export function requiredInteger(row: Row, column: string): number {
  const value = row[column]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RowMappingError(column, 'expected an integer', value)
  }
  return value
}

export function requiredDateTime(row: Row, column: string): DateTime {
  const text = requiredString(row, column)
  const parsed = parseDateTime(text)
  if (parsed === null) {
    throw new RowMappingError(column, 'is not an ISO 8601 timestamp', text)
  }
  return parsed
}

export function optionalDateTime(row: Row, column: string): DateTime | null {
  const text = optionalString(row, column)
  if (text === null) return null
  const parsed = parseDateTime(text)
  if (parsed === null) {
    throw new RowMappingError(column, 'is not an ISO 8601 timestamp', text)
  }
  return parsed
}

export function envelopeRecord(raw: unknown, column: string): Record<string, unknown> {
  return readJsonRecordEnvelope(raw, column)
}

export function envelopeArray(raw: unknown, column: string): readonly unknown[] {
  return readJsonArrayEnvelope(raw, column)
}
