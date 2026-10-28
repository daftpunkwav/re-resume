/**
 * @file MessageContext
 * @description A reference the user attached to a turn: an information entry, a
 * resume or a job posting. Only the reference is stored on the message; the
 * full content is read on demand so the transcript stays cheap.
 */

import type { InfoEntryId, JobPostingId, ResumeId } from '../shared/branded-id'

export const MESSAGE_CONTEXT_KINDS = ['entry', 'resume', 'jobPosting'] as const

export type MessageContextKind = (typeof MESSAGE_CONTEXT_KINDS)[number]

export type MessageContext =
  | { readonly kind: 'entry'; readonly refId: InfoEntryId }
  | { readonly kind: 'resume'; readonly refId: ResumeId }
  | { readonly kind: 'jobPosting'; readonly refId: JobPostingId }

export function isMessageContextKind(value: unknown): value is MessageContextKind {
  return typeof value === 'string' && (MESSAGE_CONTEXT_KINDS as readonly string[]).includes(value)
}
