/**
 * @file Resume
 * @description Aggregate root for one resume. Blocks and page setup are
 * hydrated from the current revision, so this row is a pointer plus metadata,
 * not a second copy of the document.
 *
 * Constraints:
 * - Cross-aggregate invariants (a referenced variant belongs to the experience,
 *   is confirmed, its claims are not rejected) cannot be checked here; the
 *   Resume aggregate does not hold that data. commitDocumentChange guards them.
 */

import { DomainError } from '../shared/DomainError'
import type { DateTime } from '../shared/DateTime'
import type { BlockId, ResumeId, RevisionId, SnapshotId } from '../shared/branded-id'
import { isSubstantiveContent, isProfileContent } from './Block'
import type { Block } from './Block'
import type { PageSetup } from './PageSetup'
import type { ResumeSnapshot } from './ResumeSnapshot'
import { nextSnapshotSeq } from './ResumeSnapshot'

export type ResumeStatus = 'draft' | 'frozen'

export interface Resume {
  readonly id: ResumeId
  readonly title: string
  readonly targetRole: string | null
  readonly status: ResumeStatus
  /** Current page setup; hydrated from the current revision. */
  readonly pageSetup: PageSetup
  /**
   * Ordered block sequence; order is meaningful for flow layout and DOCX
   * export. Hydrated from the current revision — the resume table stores no
   * blocks of its own.
   */
  readonly blocks: readonly Block[]
  readonly currentRevision: RevisionId
  readonly snapshots: readonly ResumeSnapshot[]
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

export interface CreateResumeInput {
  readonly id: ResumeId
  readonly title: string
  readonly targetRole: string | null
  readonly pageSetup: PageSetup
  readonly initialRevisionId: RevisionId
}

export interface HydratedDocument {
  readonly blocks: readonly Block[]
  readonly pageSetup: PageSetup
}

export function createResume(input: CreateResumeInput, now: DateTime): Resume {
  assertUniqueBlocks(input.id, [])
  return {
    id: input.id,
    title: input.title,
    targetRole: input.targetRole,
    status: 'draft',
    pageSetup: input.pageSetup,
    blocks: [],
    currentRevision: input.initialRevisionId,
    snapshots: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** Invariant 1: identifiers are unique and a resume carries at most one profile block. */
export function assertUniqueBlocks(resumeId: ResumeId, blocks: readonly Block[]): void {
  const seen = new Set<BlockId>()
  let profileBlocks = 0
  for (const block of blocks) {
    if (seen.has(block.id)) {
      throw new DomainError('duplicateBlockId', 'A block id appears twice in this resume.', {
        entity: 'resume',
        id: resumeId,
        blockers: [block.id],
      })
    }
    seen.add(block.id)
    if (isProfileContent(block.content)) profileBlocks += 1
  }
  if (profileBlocks > 1) {
    throw new DomainError(
      'multipleProfileBlocks',
      'A resume may carry at most one profile block.',
      { entity: 'resume', id: resumeId, blockers: [] },
    )
  }
}

/** Invariant 4: a frozen resume rejects every document mutation. */
export function assertMutable(resume: Resume): void {
  if (resume.status === 'frozen') {
    throw new DomainError(
      'frozenResumeImmutable',
      'This resume is frozen. Duplicate it to keep iterating.',
      { entity: 'resume', id: resume.id, blockers: [] },
    )
  }
}

/**
 * Invariant 2: freezing or exporting needs real content. A freshly created
 * empty resume is still legal to hold.
 *
 * A profile block with no display name is treated as no content: the profile
 * row is seeded empty on a fresh install and copied verbatim into agent
 * drafts, so without this check an install with no profile set could freeze
 * and export a resume carrying no name at all.
 */
export function assertHasSubstantiveContent(resumeId: ResumeId, blocks: readonly Block[]): void {
  const substantive = blocks.filter((block) => isSubstantiveContent(block.content))
  const hasUsableProfile = substantive.some(
    (block) => isProfileContent(block.content) && block.content.displayName.trim() !== '',
  )
  const hasBody = substantive.some((block) => !isProfileContent(block.content))
  if (hasUsableProfile || hasBody) return
  throw new DomainError(
    'emptyResume',
    'A resume needs text, an experience block, or a profile block with a name before it can be frozen.',
    { entity: 'resume', id: resumeId, blockers: [] },
  )
}

/** Invariant 3 is implied here: freezing always appends the snapshot it requires. */
export function freezeResume(
  resume: Resume,
  snapshotId: SnapshotId,
  now: DateTime,
  materialized: Omit<ResumeSnapshot, 'id' | 'resumeId' | 'seq' | 'createdAt'>,
): Resume {
  assertMutable(resume)
  assertHasSubstantiveContent(resume.id, resume.blocks)
  const snapshot: ResumeSnapshot = {
    ...materialized,
    id: snapshotId,
    resumeId: resume.id,
    seq: nextSnapshotSeq(resume.snapshots),
    createdAt: now,
  }
  return {
    ...resume,
    status: 'frozen',
    snapshots: [...resume.snapshots, snapshot],
    updatedAt: now,
  }
}

/** Invariant 3, stated for callers that hydrate a resume without a snapshot list. */
export function assertFrozenHasSnapshot(resume: Resume): void {
  if (resume.status === 'frozen' && resume.snapshots.length === 0) {
    throw new DomainError('frozenWithoutSnapshot', 'A frozen resume must carry a snapshot.', {
      entity: 'resume',
      id: resume.id,
      blockers: [],
    })
  }
}

export function setDocument(
  resume: Resume,
  document: HydratedDocument,
  currentRevision: RevisionId,
  now: DateTime,
): Resume {
  assertMutable(resume)
  assertUniqueBlocks(resume.id, document.blocks)
  return {
    ...resume,
    blocks: document.blocks,
    pageSetup: document.pageSetup,
    currentRevision,
    updatedAt: now,
  }
}
