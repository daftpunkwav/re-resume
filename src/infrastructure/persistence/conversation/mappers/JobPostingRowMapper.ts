/**
 * @file JobPostingRowMapper
 * @description Row to domain conversion for job postings. The parsed payload and
 * the image identifiers are envelope columns, so a row carrying a format this
 * build does not know is refused instead of partially read.
 */

import type { JobPosting, ParsedJobPosting } from '../../../../domain/generation/JobPosting'
import type { DateTime } from '../../../../domain/shared/DateTime'
import {
  asAgentRunId,
  asAttachmentId,
  asConversationId,
  asJobPostingId,
  asResumeId,
} from '../../../../domain/shared/branded-id'
import {
  RowMappingError,
  readJsonArrayEnvelope,
  readJsonRecordEnvelope,
  writeJsonEnvelope,
} from '../../JsonEnvelope'
import {
  nullableIdentifier,
  nullableText,
  nullableTimestamp,
  requiredText,
  requiredTimestamp,
  textValue,
} from './ConversationRowMapper'

export interface JobPostingRow {
  readonly id: unknown
  readonly raw_text: unknown
  readonly source: unknown
  readonly image_attachment_ids: unknown
  readonly conversation_id: unknown
  readonly resume_id: unknown
  readonly parsed_json: unknown
  readonly parsed_by_run_id: unknown
  readonly parsed_at: unknown
  readonly created_at: unknown
}

export function toJobPostingRow(posting: JobPosting): {
  readonly id: string
  readonly raw_text: string
  readonly source: string | null
  readonly image_attachment_ids: string
  readonly conversation_id: string | null
  readonly resume_id: string | null
  readonly parsed_json: string | null
  readonly parsed_by_run_id: string | null
  readonly parsed_at: DateTime | null
  readonly created_at: DateTime
} {
  return {
    id: posting.id,
    raw_text: posting.rawText,
    source: posting.source,
    image_attachment_ids: writeJsonEnvelope([...posting.imageAttachmentIds]),
    conversation_id: posting.conversationId,
    resume_id: posting.resumeId,
    parsed_json: posting.parsed === null ? null : writeJsonEnvelope(parsedToJson(posting.parsed)),
    parsed_by_run_id: posting.parsedByRunId,
    parsed_at: posting.parsedAt,
    created_at: posting.createdAt,
  }
}

export function fromJobPostingRow(row: JobPostingRow): JobPosting {
  const imageIds = readJsonArrayEnvelope(row.image_attachment_ids, 'job_posting.image_attachment_ids')
  if (imageIds.some((id) => typeof id !== 'string')) {
    throw new RowMappingError(
      'job_posting.image_attachment_ids',
      'expected an array of identifiers',
      imageIds,
    )
  }
  const parsed = row.parsed_json === null ? null : readParsed(row.parsed_json)
  const parsedByRunId = nullableIdentifier(
    row.parsed_by_run_id,
    'job_posting.parsed_by_run_id',
    asAgentRunId,
  )
  const parsedAt = nullableTimestamp(row.parsed_at, 'job_posting.parsed_at')
  if (parsed !== null && (parsedByRunId === null || parsedAt === null)) {
    throw new RowMappingError(
      'job_posting.parsed_json',
      'a parsed posting must record the run and the instant that produced it',
      row.parsed_json,
    )
  }
  return {
    id: asJobPostingId(requiredText(row.id, 'job_posting.id')),
    rawText: textValue(row.raw_text, 'job_posting.raw_text'),
    source: nullableText(row.source, 'job_posting.source'),
    imageAttachmentIds: imageIds.map((id) => asAttachmentId(String(id))),
    conversationId: nullableIdentifier(
      row.conversation_id,
      'job_posting.conversation_id',
      asConversationId,
    ),
    resumeId: nullableIdentifier(row.resume_id, 'job_posting.resume_id', asResumeId),
    parsed,
    parsedByRunId,
    parsedAt,
    createdAt: requiredTimestamp(row.created_at, 'job_posting.created_at'),
  }
}

function readParsed(raw: unknown): ParsedJobPosting {
  const record = readJsonRecordEnvelope(raw, 'job_posting.parsed_json')
  return {
    title: nullableText(record.title, 'job_posting.parsed_json.title'),
    company: nullableText(record.company, 'job_posting.parsed_json.company'),
    responsibilities: readStringList(record.responsibilities, 'job_posting.parsed_json.responsibilities'),
    requirements: readStringList(record.requirements, 'job_posting.parsed_json.requirements'),
    keywords: readStringList(record.keywords, 'job_posting.parsed_json.keywords'),
  }
}

function parsedToJson(parsed: ParsedJobPosting): Record<string, unknown> {
  return {
    title: parsed.title,
    company: parsed.company,
    responsibilities: [...parsed.responsibilities],
    requirements: [...parsed.requirements],
    keywords: [...parsed.keywords],
  }
}

function readStringList(value: unknown, column: string): readonly string[] {
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
