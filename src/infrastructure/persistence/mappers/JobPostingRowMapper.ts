/**
 * @file JobPostingRowMapper
 * @description Row conversion for job_posting. The parsed payload goes through
 * the shared envelope reader, so an unknown format is refused rather than
 * guessed at — a silently mis-parsed requirement list would reach the agent.
 */

import { parseDateTime } from '../../../domain/shared/DateTime'
import { RowMappingError, readJsonRecordEnvelope, writeJsonEnvelope } from './JsonEnvelope'
import { asAgentRunId, asJobPostingId } from '../../../domain/shared/branded-id'
import type { JobPosting, ParsedJobPosting } from '../../../domain/generation/JobPosting'

export interface JobPostingRow {
  readonly id: string
  readonly raw_text: string
  readonly source: string | null
  readonly parsed_json: string | null
  readonly parsed_by_run_id: string | null
  readonly parsed_at: string | null
  readonly created_at: string
}

function readStringList(value: unknown, column: string): readonly string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new RowMappingError(column, 'expected an array of strings', value)
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new RowMappingError(`${column}[${index}]`, 'expected a string', entry)
    }
    return entry
  })
}

function readNullableText(value: unknown, column: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new RowMappingError(column, 'expected a string or null', value)
  }
  return value
}

/**
 * Every field is checked rather than coerced. A silently dropped requirement
 * would leave the agent matching against a posting it can no longer fully
 * read, and the cause would be invisible at the point it mattered.
 */
function readParsed(raw: string, id: string): ParsedJobPosting {
  const column = `job_posting(${id}).parsed_json`
  const record = readJsonRecordEnvelope(raw, column)
  return {
    title: readNullableText(record.title, `${column}.title`),
    company: readNullableText(record.company, `${column}.company`),
    responsibilities: readStringList(record.responsibilities, `${column}.responsibilities`),
    requirements: readStringList(record.requirements, `${column}.requirements`),
    keywords: readStringList(record.keywords, `${column}.keywords`),
  }
}

export function toJobPosting(row: JobPostingRow): JobPosting {
  const id = asJobPostingId(row.id)
  const createdAt = parseDateTime(row.created_at)
  if (createdAt === null) {
    throw new RowMappingError(`job_posting(${id}).created_at`, 'expected an ISO 8601 timestamp', row.created_at)
  }
  const parsedAt = row.parsed_at === null ? null : parseDateTime(row.parsed_at)
  if (row.parsed_at !== null && parsedAt === null) {
    throw new RowMappingError(`job_posting(${id}).parsed_at`, 'expected an ISO 8601 timestamp', row.parsed_at)
  }
  return {
    id,
    rawText: row.raw_text,
    source: row.source,
    parsed: row.parsed_json === null ? null : readParsed(row.parsed_json, id),
    parsedByRunId:
      row.parsed_by_run_id === null ? null : asAgentRunId(row.parsed_by_run_id),
    parsedAt,
    createdAt,
  }
}

export function fromJobPosting(jobPosting: JobPosting): JobPostingRow {
  return {
    id: jobPosting.id,
    raw_text: jobPosting.rawText,
    source: jobPosting.source,
    parsed_json:
      jobPosting.parsed === null ? null : writeJsonEnvelope(jobPosting.parsed),
    parsed_by_run_id: jobPosting.parsedByRunId,
    parsed_at: jobPosting.parsedAt,
    created_at: jobPosting.createdAt,
  }
}
