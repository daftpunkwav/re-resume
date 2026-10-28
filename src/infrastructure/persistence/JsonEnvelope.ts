/**
 * @file JsonEnvelope
 * @description The storage contract shared by every `*_json` column: each one
 * stores `{"v":1,"data":…}`, never a bare value. Reads check `v` before
 * touching `data` and refuse an unknown version outright — guessing at a
 * payload shape we were not written for is how a silently corrupted document
 * becomes a silently corrupted export.
 *
 * Constraints:
 * - The envelope version is independent of the DDL migration version: a JSON
 *   format change never requires a table change, and a table change never
 *   implies a JSON change.
 * - Malformed storage is reported, never repaired. A caller that cannot read a
 *   row must fail loudly rather than substitute a default.
 * - RowMappingError is the single type every mapper raises for a violated row
 *   contract, so a caller can tell "this row is bad" apart from a programming
 *   fault without matching on message text.
 */

/** The only envelope version this build reads or writes. */
export const JSON_ENVELOPE_VERSION = 1

/** Longest stored value reproduced in an error message before truncating. */
const STORED_VALUE_PREVIEW_LENGTH = 120

/**
 * Raised when a stored row violates the column contract: a missing value, a
 * value of the wrong SQL type, an unparsable timestamp or a JSON envelope this
 * build does not understand.
 */
export class RowMappingError extends Error {
  readonly column: string
  readonly reason: string
  readonly storedValue: string

  constructor(column: string, reason: string, storedValue: unknown, options?: ErrorOptions) {
    super(`${column}: ${reason} (stored ${previewOf(storedValue)})`, options)
    this.name = 'RowMappingError'
    this.column = column
    this.reason = reason
    this.storedValue = previewOf(storedValue)
  }
}

export function writeJsonEnvelope(data: unknown): string {
  return JSON.stringify({ v: JSON_ENVELOPE_VERSION, data })
}

/**
 * Returns the payload of a stored envelope. Throws RowMappingError when the
 * text is not JSON, is not an envelope object, or carries a version other than
 * JSON_ENVELOPE_VERSION.
 */
export function readJsonEnvelope(raw: unknown, column: string): unknown {
  if (typeof raw !== 'string') {
    throw new RowMappingError(column, 'expected a JSON envelope stored as text', raw)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new RowMappingError(column, 'stored text is not valid JSON', raw, { cause: error })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RowMappingError(column, 'stored text is not a JSON envelope object', raw)
  }
  const envelope = parsed as { readonly v?: unknown; readonly data?: unknown }
  const version = envelope.v
  if (version !== JSON_ENVELOPE_VERSION) {
    throw new RowMappingError(
      column,
      `envelope version ${describeVersion(version)} is not supported by this build`,
      raw,
    )
  }
  return envelope.data
}

/**
 * Same as readJsonEnvelope but additionally requires the payload to be a JSON
 * object. Used by columns whose domain type is a record rather than a list or
 * a scalar.
 */
export function readJsonRecordEnvelope(raw: unknown, column: string): Record<string, unknown> {
  const data = readJsonEnvelope(raw, column)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new RowMappingError(column, 'envelope payload is not a JSON object', raw)
  }
  return data as Record<string, unknown>
}

/** Same as readJsonEnvelope but additionally requires the payload to be a JSON array. */
export function readJsonArrayEnvelope(raw: unknown, column: string): readonly unknown[] {
  const data = readJsonEnvelope(raw, column)
  if (!Array.isArray(data)) {
    throw new RowMappingError(column, 'envelope payload is not a JSON array', raw)
  }
  return data
}

/** Same as readJsonEnvelope but additionally requires the payload to be a JSON string. */
export function readJsonStringEnvelope(raw: unknown, column: string): string {
  const data = readJsonEnvelope(raw, column)
  if (typeof data !== 'string') {
    throw new RowMappingError(column, 'envelope payload is not a JSON string', raw)
  }
  return data
}

function describeVersion(version: unknown): string {
  if (typeof version === 'number') return String(version)
  if (version === undefined) return 'missing'
  return JSON.stringify(version) ?? String(version)
}

function previewOf(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : value === null
        ? 'null'
        : typeof value === 'object'
          ? Object.prototype.toString.call(value)
          : String(value)
  return text.length > STORED_VALUE_PREVIEW_LENGTH
    ? `${text.slice(0, STORED_VALUE_PREVIEW_LENGTH)}…`
    : text
}
