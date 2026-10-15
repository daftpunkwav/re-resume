/**
 * @file JobPostingRowMapper
 * @description Row conversion for job_posting. The parsed payload goes through
 * the shared envelope reader, so an unknown format is refused rather than
 * guessed at — a silently mis-parsed requirement list would reach the agent.
 */

import { parseDateTime } from '../../../domain/shared/DateTime'
import { RowMappingError, readJsonEnvelope, writeJsonEnvelope } from './JsonEnvelope'
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

function readParsed(raw: string, id: string): ParsedJobPosting {
  const data = readJsonEnvelope(raw, `job_posting(${id}).parsed_json`)
  const record = data as Partial<ParsedJobPosting>
  const stringList = (value: unknown): readonly string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  const nullableText = (value: unknown): string | null =>
    typeof value === 'string' ? value : null

  return {
    title: nullableText(record.title),
    company: nullableText(record.company),
    responsibilities: stringList(record.responsibilities),
    requirements: stringList(record.requirements),
    keywords: stringList(record.keywords),
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
