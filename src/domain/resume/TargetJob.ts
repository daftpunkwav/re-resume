/**
 * @file TargetJob
 * @description The job a resume is aimed at. The title and company are copied
 * into the resume so they survive deletion of the posting they came from; the
 * posting identifier is kept only as provenance and may become a missing
 * reference.
 *
 * Constraints:
 * - Metadata only: the value lives on the resume row, not in the revision chain
 *   (renaming a target does not belong in undo history).
 * - This module is pure: no DOM, no storage, no package.
 */

import type { JobPostingId } from '../shared/branded-id'
import { DomainError } from '../shared/DomainError'
import { countCodePoints } from '../info/codePoints'

/** Longest accepted title or company, in code points. */
export const TARGET_JOB_FIELD_MAX_LENGTH = 80

export interface TargetJob {
  readonly title: string | null
  readonly company: string | null
  /** Provenance of the posting the value was copied from; null when typed. */
  readonly jobPostingId: JobPostingId | null
}

function normalizeField(value: string | null): string | null {
  if (value === null) return null
  const text = value.trim()
  return text === '' ? null : text
}

function assertFieldLength(value: string | null, field: 'title' | 'company'): void {
  if (value === null) return
  if (countCodePoints(value) <= TARGET_JOB_FIELD_MAX_LENGTH) return
  throw new DomainError(
    'fieldTooLong',
    `The target job ${field} may be at most ${TARGET_JOB_FIELD_MAX_LENGTH.toString()} characters.`,
    { entity: 'targetJob', id: field, blockers: [field] },
  )
}

/**
 * Trims both text fields and turns a blank one into null, then checks the
 * length bound. Returns the value that gets stored.
 *
 * @throws DomainError `fieldTooLong` when either text exceeds the bound.
 */
export function normalizeTargetJob(target: TargetJob): TargetJob {
  const title = normalizeField(target.title)
  const company = normalizeField(target.company)
  assertFieldLength(title, 'title')
  assertFieldLength(company, 'company')
  return { title, company, jobPostingId: target.jobPostingId }
}
