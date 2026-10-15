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
 * - The chain read is declared below as LiveRevisionChain; it is a dependency
 *   this use case receives, not a member it invents on the repository.
 */

import { DomainError } from '../../domain/shared/DomainError'
import { assertMutable } from '../../domain/resume/Resume'
import type { Resume } from '../../domain/resume/Resume'
import { isLiveRevision } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { ResumeId } from '../../domain/shared/branded-id'

/**
 * The chain of revisions, oldest first, including superseded rows. The use
 * case filters them; the read itself is the repository's.
 *
 * Why this is declared here rather than on the port: ResumeRepository is a
 * CRUD-shaped domain vocabulary (find, list, save, move, read one, append) and
 * it offers no way to enumerate revisions — readRevision addresses a single
 * revision by id. The data exists: SqliteResumeRepository reads it in a
 * private #readHistory, and the in-memory test double exposes historyOf. Both
 * are out of this layer's reach, so the composition root supplies this read to
 * the use cases that walk the chain (undo, redo, and the freeze guard). The
 * return type admits both a plain sequence and a promise of one, because the
 * two implementations answer at different speeds.
 *
 * If a listing is later published on the port, this type is the seam that goes
 * away with it.
 */
export type LiveRevisionChain = (
  resumeId: ResumeId,
) => readonly Revision[] | Promise<readonly Revision[]>

export async function undoDocumentChange(
  resumeRepo: ResumeRepository,
  readChain: LiveRevisionChain,
  resumeId: ResumeId,
): Promise<Revision> {
  const resume = await loadResume(resumeRepo, resumeId)
  assertMutable(resume)
  const chain = await liveChain(readChain, resumeId)
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
  readChain: LiveRevisionChain,
  resumeId: ResumeId,
): Promise<readonly Revision[]> {
  const revisions = await readChain(resumeId)
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
