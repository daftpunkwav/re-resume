/**
 * @file UndoDocumentChange
 * @description Moves the resume cursor one step back along the live revision
 * chain. Undo creates nothing: it re-hydrates the resume from a revision that
 * already exists.
 *
 * Responsibilities:
 * - Locate the predecessor on the chain of unsuperseded revisions
 * - Refuse a frozen resume and an exhausted chain
 *
 * Constraints:
 * - Superseded rows are filtered before the predecessor is chosen. Picking
 *   max(seq) over all rows would land the cursor on an abandoned branch.
 * - The chain arrives through ResumeRepository.listRevisions; which branch is
 *   live is a use case decision, not a storage one.
 */

import { DomainError } from '../../domain/shared/DomainError'
import { assertMutable } from '../../domain/resume/Resume'
import type { Resume } from '../../domain/resume/Resume'
import { isLiveRevision } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { ResumeId } from '../../domain/shared/branded-id'

export async function undoDocumentChange(
  resumeRepo: ResumeRepository,
  resumeId: ResumeId,
): Promise<Revision> {
  const resume = await loadResume(resumeRepo, resumeId)
  assertMutable(resume)
  const chain = await liveChain(resumeRepo, resumeId)
  const position = chain.findIndex((revision) => revision.id === resume.currentRevision)
  if (position < 0) {
    throw new DomainError(
      'cursorNotOnLiveChain',
      'The cursor is not on the live chain, so it has no predecessor to return to.',
      { entity: 'resume', id: resumeId, blockers: [resume.currentRevision] },
    )
  }
  const predecessor = position > 0 ? chain[position - 1] : undefined
  if (predecessor === undefined) {
    throw new DomainError(
      'cursorNotOnLiveChain',
      'The cursor already sits on the initial revision; there is nothing earlier to undo.',
      { entity: 'resume', id: resumeId, blockers: [] },
    )
  }
  await resumeRepo.moveCursor(resumeId, predecessor.id)
  return predecessor
}

async function liveChain(
  resumeRepo: ResumeRepository,
  resumeId: ResumeId,
): Promise<readonly Revision[]> {
  const revisions = await resumeRepo.listRevisions(resumeId)
  return revisions.filter(isLiveRevision).sort((left, right) => left.seq - right.seq)
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
