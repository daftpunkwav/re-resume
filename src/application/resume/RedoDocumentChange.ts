/**
 * @file RedoDocumentChange
 * @description Moves the resume cursor one step forward along the live revision
 * chain. Like undo it creates nothing; the revision it restores already exists.
 *
 * Responsibilities:
 * - Locate the successor on the chain of unsuperseded revisions
 * - Refuse a frozen resume and a cursor already at the head
 *
 * Constraints:
 * - Superseded rows are filtered before the successor is chosen. After a
 *   commit-while-undone the abandoned tail is marked superseded, and a naive
 *   max(seq) scan would offer it as redoable history.
 */

import { DomainError } from '../../domain/shared/DomainError'
import { assertMutable } from '../../domain/resume/Resume'
import type { Resume } from '../../domain/resume/Resume'
import { isLiveRevision } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { ResumeId } from '../../domain/shared/branded-id'

export async function redoDocumentChange(
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
      'The cursor is not on the live chain, so it has no successor to move to.',
      { entity: 'resume', id: resumeId, blockers: [resume.currentRevision] },
    )
  }
  const successor = position < chain.length - 1 ? chain[position + 1] : undefined
  if (successor === undefined) {
    throw new DomainError(
      'cursorNotOnLiveChain',
      'The cursor already sits on the newest revision; there is nothing to redo.',
      { entity: 'resume', id: resumeId, blockers: [] },
    )
  }
  await resumeRepo.moveCursor(resumeId, successor.id)
  return successor
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
