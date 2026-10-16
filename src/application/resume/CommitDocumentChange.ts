/**
 * @file CommitDocumentChange
 * @description The single entry point allowed to change a resume's blocks.
 * Every mutation — user edit, agent draft, undo abandonment — arrives here as
 * a DocumentChange and leaves as one revision.
 *
 * Responsibilities:
 * - Refuse a frozen resume (aggregate invariant 4)
 * - Enforce cross-aggregate invariants 5-7, which the Resume aggregate cannot
 *   see because it holds neither Variant nor Claim rows
 * - Append the revision only after the change and every guard have succeeded
 *
 * Constraints:
 * - Nothing is written when the change throws or a guard refuses. The guards
 *   run on the state the change produced: a change that drops a reference to a
 *   rejected claim has to be able to succeed, or the user could never clear
 *   the reference.
 */

import { DomainError } from '../../domain/shared/DomainError'
import { assertMutable, assertUniqueBlocks } from '../../domain/resume/Resume'
import type { Resume } from '../../domain/resume/Resume'
import type { Revision } from '../../domain/resume/Revision'
import type { DocumentChange, DocumentState } from '../../domain/resume/DocumentChange'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { ResumeId } from '../../domain/shared/branded-id'
import { assertBlocksMayBeReferenced } from './assertBlockReferences'

export async function commitDocumentChange(
  resumeRepo: ResumeRepository,
  experienceRepo: ExperienceRepository,
  resumeId: ResumeId,
  change: DocumentChange,
): Promise<Revision> {
  const resume = await loadResume(resumeRepo, resumeId)
  assertMutable(resume)
  const state: DocumentState = change.next({
    blocks: resume.blocks,
    pageSetup: resume.pageSetup,
  })
  assertUniqueBlocks(resumeId, state.blocks)
  await assertBlocksMayBeReferenced(experienceRepo, state.blocks)
  return resumeRepo.saveDocument(resumeId, state, change, resume.currentRevision)
}

/**
 * The closed DomainError code set has no "not found" member, so a missing row
 * is reported as the code the resume port's own implementations already use
 * when they cannot resolve the resume's revision chain.
 */
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
