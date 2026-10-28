/**
 * @file ConversationRowMapper
 * @description Row to domain conversion for conversation rows. Every column is
 * checked rather than coerced: a row that is not the shape this build wrote is
 * reported, never repaired into a plausible conversation.
 */

import { parseDateTime } from '../../../../domain/shared/DateTime'
import type { DateTime } from '../../../../domain/shared/DateTime'
import { asConversationId, asResumeId } from '../../../../domain/shared/branded-id'
import type { Conversation } from '../../../../domain/conversation/Conversation'
import { RowMappingError } from '../../JsonEnvelope'

export interface ConversationRow {
  readonly id: unknown
  readonly title: unknown
  readonly provider_id: unknown
  readonly model_id: unknown
  readonly pinned: unknown
  readonly active_resume_id: unknown
  readonly summary: unknown
  readonly summary_through_seq: unknown
  readonly created_at: unknown
  readonly updated_at: unknown
}

export function toConversationRow(conversation: Conversation): {
  readonly id: string
  readonly title: string
  readonly provider_id: string | null
  readonly model_id: string | null
  readonly pinned: number
  readonly active_resume_id: string | null
  readonly summary: string | null
  readonly summary_through_seq: number | null
  readonly created_at: DateTime
  readonly updated_at: DateTime
} {
  return {
    id: conversation.id,
    title: conversation.title,
    provider_id: conversation.providerId,
    model_id: conversation.modelId,
    pinned: conversation.pinned ? 1 : 0,
    active_resume_id: conversation.activeResumeId,
    summary: conversation.summary,
    summary_through_seq: conversation.summaryThroughSeq,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
  }
}

export function fromConversationRow(row: ConversationRow): Conversation {
  const summaryThroughSeq = row.summary_through_seq
  if (summaryThroughSeq !== null && (typeof summaryThroughSeq !== 'number' || !Number.isInteger(summaryThroughSeq) || summaryThroughSeq < 0)) {
    throw new RowMappingError('conversation.summary_through_seq', 'expected a non-negative integer or null', summaryThroughSeq)
  }
  return {
    id: asConversationId(requiredText(row.id, 'conversation.id')),
    title: requiredText(row.title, 'conversation.title'),
    providerId: nullableText(row.provider_id, 'conversation.provider_id'),
    modelId: nullableText(row.model_id, 'conversation.model_id'),
    pinned: requiredFlag(row.pinned, 'conversation.pinned'),
    activeResumeId:
      row.active_resume_id === null || row.active_resume_id === undefined
        ? null
        : asResumeId(requiredText(row.active_resume_id, 'conversation.active_resume_id')),
    summary: nullableText(row.summary, 'conversation.summary'),
    summaryThroughSeq,
    createdAt: requiredTimestamp(row.created_at, 'conversation.created_at'),
    updatedAt: requiredTimestamp(row.updated_at, 'conversation.updated_at'),
  }
}

export function requiredText(value: unknown, column: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new RowMappingError(column, 'expected a non-empty string', value)
  }
  return value
}

/** Text that may legitimately be empty, such as a streamed answer before its first delta. */
export function textValue(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new RowMappingError(column, 'expected text', value)
  }
  return value
}

export function nullableText(value: unknown, column: string): string | null {
  if (value === null || value === undefined) return null
  return textValue(value, column)
}

export function requiredTimestamp(value: unknown, column: string): DateTime {
  const raw = requiredText(value, column)
  const parsed = parseDateTime(raw)
  if (parsed === null) {
    throw new RowMappingError(column, 'expected an ISO 8601 timestamp', raw)
  }
  return parsed
}

export function nullableTimestamp(value: unknown, column: string): DateTime | null {
  if (value === null || value === undefined) return null
  return requiredTimestamp(value, column)
}

export function requiredFlag(value: unknown, column: string): boolean {
  if (value === 1) return true
  if (value === 0) return false
  throw new RowMappingError(column, 'expected the flag 0 or 1', value)
}

export function requiredInteger(value: unknown, column: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RowMappingError(column, 'expected an integer', value)
  }
  return value
}

export function nullableInteger(value: unknown, column: string): number | null {
  if (value === null || value === undefined) return null
  return requiredInteger(value, column)
}

/** Reconstructs an optional identifier, naming the column when it is malformed. */
export function nullableIdentifier<T>(
  value: unknown,
  column: string,
  reconstruct: (raw: string) => T,
): T | null {
  if (value === null || value === undefined) return null
  return reconstruct(requiredText(value, column))
}

/** Shared row validation for every mapper in this directory. */
export { RowMappingError }
