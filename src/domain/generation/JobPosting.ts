/**
 * @file JobPosting
 * @description A pasted job description plus, once parsed, the extracted
 * requirements. The parse keeps its provenance so the result never appears
 * without a source.
 */

import type { DateTime } from '../shared/DateTime'
import type { AgentRunId, JobPostingId } from '../shared/branded-id'

export interface ParsedJobPosting {
  readonly title: string | null
  readonly company: string | null
  readonly responsibilities: readonly string[]
  readonly requirements: readonly string[]
  readonly keywords: readonly string[]
}

export interface JobPosting {
  readonly id: JobPostingId
  readonly rawText: string
  readonly source: string | null
  readonly parsed: ParsedJobPosting | null
  /** Provenance of the parse: which agent run produced it, and when. */
  readonly parsedByRunId: AgentRunId | null
  readonly parsedAt: DateTime | null
  readonly createdAt: DateTime
}

export function attachParse(
  posting: JobPosting,
  parsed: ParsedJobPosting,
  runId: AgentRunId,
  now: DateTime,
): JobPosting {
  return { ...posting, parsed, parsedByRunId: runId, parsedAt: now }
}
