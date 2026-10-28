/**
 * @file JobPosting
 * @description A job description the user supplied, plus the structured
 * requirements a model extracted from it. The parse keeps its provenance: a
 * parsed record never appears without the run that produced it.
 *
 * Constraints:
 * - A posting has text or images, never neither. The table CHECK says the same.
 * - `parsed` non-null implies `parsedByRunId` and `parsedAt` are non-null.
 */

import type { DateTime } from '../shared/DateTime'
import type {
  AgentRunId,
  AttachmentId,
  ConversationId,
  JobPostingId,
  ResumeId,
} from '../shared/branded-id'

export interface ParsedJobPosting {
  readonly title: string | null
  readonly company: string | null
  readonly responsibilities: readonly string[]
  readonly requirements: readonly string[]
  readonly keywords: readonly string[]
}

export interface JobPosting {
  readonly id: JobPostingId
  /** The pasted description; for an image input, the model transcription. */
  readonly rawText: string
  /** 'paste' | 'image' | 'manual', or null when the origin was not recorded. */
  readonly source: string | null
  readonly imageAttachmentIds: readonly AttachmentId[]
  readonly conversationId: ConversationId | null
  readonly resumeId: ResumeId | null
  readonly parsed: ParsedJobPosting | null
  readonly parsedByRunId: AgentRunId | null
  readonly parsedAt: DateTime | null
  readonly createdAt: DateTime
}

/** True when the posting carries something a parse can read. */
export function hasJobPostingContent(posting: JobPosting): boolean {
  return posting.rawText !== '' || posting.imageAttachmentIds.length > 0
}

export function attachParse(
  posting: JobPosting,
  parsed: ParsedJobPosting,
  runId: AgentRunId,
  now: DateTime,
): JobPosting {
  return { ...posting, parsed, parsedByRunId: runId, parsedAt: now }
}
