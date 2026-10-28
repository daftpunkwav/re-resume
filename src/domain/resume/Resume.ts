/**
 * @file Resume
 * @description Aggregate root for one resume: metadata (title, target job,
 * status, conversation) plus the document state hydrated from the revision the
 * cursor names. The document itself lives in revisions, so this aggregate is a
 * pointer and a policy set, not a second copy of the content.
 *
 * Responsibilities:
 * - Declare the aggregate and its status
 * - Enforce the metadata rules (title)
 * - Enforce the guards every document write and the freeze transition share
 * - State which missing references block freezing
 *
 * Constraints:
 * - Cross-aggregate reference checks are not here: the aggregate holds entry
 *   identifiers, not entries. The read path reports missing references and the
 *   write path validates the composition change it is given.
 * - Pure data: no DOM, no storage, no package.
 */

import type { ConversationId, ResumeId, RevisionId } from '../shared/branded-id'
import type { DateTime } from '../shared/DateTime'
import { DomainError } from '../shared/DomainError'
import { countCodePoints } from '../info/codePoints'
import type { ResumeDocumentState } from './DocumentState'
import type { MissingReference } from './MissingReference'
import type { ResumeSnapshot } from './ResumeSnapshot'
import type { TargetJob } from './TargetJob'

export type ResumeStatus = 'draft' | 'frozen'

/** Longest accepted resume title, in code points. */
export const RESUME_TITLE_MAX_LENGTH = 80

export interface Resume {
  readonly id: ResumeId
  readonly title: string
  readonly targetJob: TargetJob | null
  readonly status: ResumeStatus
  /** Hydrated from `currentRevision`; never stored on the resume row. */
  readonly document: ResumeDocumentState
  readonly currentRevision: RevisionId
  readonly snapshots: readonly ResumeSnapshot[]
  readonly conversationId: ConversationId | null
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

/**
 * Trims a resume title and validates its bounds. The trimmed value is what gets
 * stored, so a title never carries surrounding whitespace.
 *
 * @throws DomainError `blankRequiredField` for an empty title, `fieldTooLong`
 *   past 80 code points.
 */
export function normalizeResumeTitle(raw: string): string {
  const title = raw.trim()
  if (title === '') {
    throw new DomainError('blankRequiredField', 'A resume needs a title.', {
      entity: 'resume',
      id: 'title',
      blockers: ['title'],
    })
  }
  if (countCodePoints(title) > RESUME_TITLE_MAX_LENGTH) {
    throw new DomainError(
      'fieldTooLong',
      `A resume title may be at most ${RESUME_TITLE_MAX_LENGTH.toString()} characters.`,
      { entity: 'resume', id: 'title', blockers: ['title'] },
    )
  }
  return title
}

/** A frozen resume rejects every document mutation and undo/redo. */
export function assertMutable(resume: Resume): void {
  if (resume.status === 'frozen') {
    throw new DomainError('resumeFrozen', 'This resume is frozen. Duplicate it to keep editing.', {
      entity: 'resume',
      id: resume.id,
      blockers: [],
    })
  }
}

/**
 * At least one visible section must select content before a resume can be
 * finalized. A freshly created empty resume is still legal to hold.
 *
 * @throws DomainError `emptyResume`.
 */
export function assertHasRenderableContent(resume: Resume): void {
  const hasContent = resume.document.sections.some(
    (section) => section.visible && section.entryIds.length > 0,
  )
  if (hasContent) return
  throw new DomainError(
    'emptyResume',
    'A resume needs at least one visible section with content before it can be finalized.',
    { entity: 'resume', id: resume.id, blockers: [] },
  )
}

/**
 * Freezing requires a content-bearing document whose rendered references all
 * resolve, so a frozen export can never meet a placeholder.
 *
 * Missing entry, custom-module and template references block the transition. An
 * orphan override and a deleted job posting do not: neither is rendered, and
 * the interface offers a cleanup path instead.
 *
 * @throws DomainError `emptyResume` or `missingReference`.
 */
export function assertFreezable(
  resume: Resume,
  missingReferences: readonly MissingReference[],
): void {
  assertHasRenderableContent(resume)
  const blocking = missingReferences.filter(
    (reference) =>
      reference.kind === 'entry' ||
      reference.kind === 'customModule' ||
      reference.kind === 'template',
  )
  if (blocking.length === 0) return
  throw new DomainError(
    'missingReference',
    'Resolve the missing references before finalizing this resume.',
    {
      entity: 'resume',
      id: resume.id,
      blockers: blocking.map((reference) => missingReferenceId(reference)),
    },
  )
}

/** The identifier a missing reference names, for the error detail. */
export function missingReferenceId(reference: MissingReference): string {
  switch (reference.kind) {
    case 'entry':
      return reference.entryId
    case 'customModule':
      return reference.moduleId
    case 'override':
      return reference.overrideId
    case 'template':
      return reference.templateId
    case 'jobPosting':
      return reference.jobPostingId
  }
}

/** Invariant check for callers that hydrate a resume without its snapshots. */
export function assertFrozenHasSnapshot(resume: Resume): void {
  if (resume.status === 'frozen' && resume.snapshots.length === 0) {
    throw new DomainError('frozenWithoutSnapshot', 'A frozen resume must carry a snapshot.', {
      entity: 'resume',
      id: resume.id,
      blockers: [],
    })
  }
}
