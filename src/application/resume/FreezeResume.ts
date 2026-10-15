/**
 * @file FreezeResume
 * @description Freezing is the one explicit transition to an immutable resume:
 * every reference is materialized into a snapshot and the document stops
 * accepting changes.
 *
 * Responsibilities:
 * - Refuse a document that still carries unconfirmed statements
 * - Refuse a cursor that has been moved back from the newest revision
 * - Materialize the blocks and append the resulting snapshot
 *
 * Constraints:
 * - Freezing never rewrites the blocks. The snapshot is the frozen form; the
 *   live document stays as it was so duplication can copy it.
 * - The cursor must sit on the newest revision, otherwise "finalize" would
 *   silently publish a state the user already undid.
 */

import { DomainError } from '../../domain/shared/DomainError'
// freezeResumeAggregate is aliased because this module exports the finalize
// use case under the same name.
import {
  assertHasSubstantiveContent,
  assertMutable,
  freezeResume as freezeResumeAggregate,
} from '../../domain/resume/Resume'
import type { Resume } from '../../domain/resume/Resume'
import type { ResumeSnapshot } from '../../domain/resume/ResumeSnapshot'
import { isExperienceContent } from '../../domain/resume/Block'
import type { ExperienceContent } from '../../domain/resume/Block'
import { isLiveRevision } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import type { Experience } from '../../domain/catalog/Experience'
import type { Clock } from '../../domain/catalog/ports/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { ExperienceId, ResumeId } from '../../domain/shared/branded-id'
import { asSnapshotId } from '../../domain/shared/branded-id'
import { materializeBlocks } from './materializeBlocks'
import type { LiveRevisionChain } from './UndoDocumentChange'

export async function freezeResume(
  resumeRepo: ResumeRepository,
  experienceRepo: ExperienceRepository,
  readChain: LiveRevisionChain,
  ids: IdGenerator,
  clock: Clock,
  resumeId: ResumeId,
): Promise<ResumeSnapshot> {
  const resume = await loadResume(resumeRepo, resumeId)
  assertMutable(resume)
  await assertCursorIsNewest(readChain, resume)
  await assertNoPendingClaim(experienceRepo, resume)
  assertHasSubstantiveContent(resume.id, resume.blocks)
  const frozen = freezeResumeAggregate(
    resume,
    asSnapshotId(ids.next()),
    clock.now(),
    {
      materializedBlocks: await materializeBlocks(
        experienceRepo,
        resume.id,
        resume.blocks,
      ),
      pageSetup: resume.pageSetup,
    },
  )
  const snapshot = frozen.snapshots[frozen.snapshots.length - 1]
  if (snapshot === undefined) {
    throw new DomainError('frozenWithoutSnapshot', 'Freezing produced no snapshot.', {
      entity: 'resume',
      id: resumeId,
      blockers: [],
    })
  }
  await resumeRepo.appendSnapshot(snapshot)
  return snapshot
}

async function assertCursorIsNewest(
  readChain: LiveRevisionChain,
  resume: Resume,
): Promise<void> {
  const revisions: readonly Revision[] = await readChain(resume.id)
  const live = revisions.filter(isLiveRevision).sort((left, right) => left.seq - right.seq)
  const newest = live[live.length - 1]
  if (newest !== undefined && newest.id === resume.currentRevision) return
  throw new DomainError(
    'cursorNotOnLiveChain',
    'Only the newest revision can be finalized; the cursor has been moved back.',
    { entity: 'resume', id: resume.id, blockers: [resume.currentRevision] },
  )
}

async function assertNoPendingClaim(
  experienceRepo: ExperienceRepository,
  resume: Resume,
): Promise<void> {
  const loaded = new Map<ExperienceId, Experience>()
  const pending: string[] = []
  for (const block of resume.blocks) {
    if (!isExperienceContent(block.content)) continue
    const experience = await loadExperience(experienceRepo, loaded, resume.id, block.content)
    for (const claimId of pendingClaimIds(experience, block.content)) pending.push(claimId)
  }
  if (pending.length === 0) return
  throw new DomainError(
    'claimPending',
    'Confirm the statements this resume cites before finalizing it.',
    { entity: 'resume', id: resume.id, blockers: pending },
  )
}

function pendingClaimIds(experience: Experience, content: ExperienceContent): readonly string[] {
  const pending: string[] = []
  for (const claimId of content.claimIds) {
    const claim = experience.claims.find((entry) => entry.id === claimId)
    if (claim === undefined) {
      // A claim the user deleted can no longer be confirmed; the domain treats
      // an unresolvable claim reference as rejected.
      throw new DomainError(
        'claimRejected',
        'A claim referenced by this block no longer exists.',
        { entity: 'resume', id: content.experienceId, blockers: [claimId] },
      )
    }
    if (claim.status === 'pending') pending.push(claimId)
  }
  return pending
}

async function loadExperience(
  experienceRepo: ExperienceRepository,
  loaded: Map<ExperienceId, Experience>,
  resumeId: ResumeId,
  content: ExperienceContent,
): Promise<Experience> {
  const cached = loaded.get(content.experienceId)
  if (cached !== undefined) return cached
  const experience = await experienceRepo.findById(content.experienceId)
  if (experience === null) {
    throw new DomainError(
      'variantNotInExperience',
      'A block references an experience that no longer exists.',
      { entity: 'resume', id: resumeId, blockers: [content.experienceId] },
    )
  }
  loaded.set(content.experienceId, experience)
  return experience
}

async function loadResume(resumeRepo: ResumeRepository, resumeId: ResumeId): Promise<Resume> {
  const resume = await resumeRepo.findById(resumeId)
  if (resume === null) {
    throw new DomainError('cursorNotOnLiveChain', 'No resume with this id exists.', {
      entity: 'resume',
      id: resumeId,
      blockers: [],
    })
  }
  return resume
}
