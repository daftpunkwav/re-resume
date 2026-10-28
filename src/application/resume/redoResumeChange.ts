/**
 * @file redoResumeChange
 * @description Moves the resume cursor one step forward along the live revision
 * chain. Like undo it creates nothing; the revision it restores already exists.
 *
 * Constraints:
 * - A frozen resume has no redo: its history is read-only.
 * - Superseded rows are filtered before the successor is chosen, so an
 *   abandoned branch is never offered as redoable history.
 */

import { assertMutable } from '../../domain/resume/Resume'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeId } from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import type { ResumeStoreDeps } from './resumeSource'
import { loadResume } from './resumeSource'
import { cursorNotOnLiveChain, cursorPosition, liveRevisionChain } from './revisionChain'

export async function redoResumeChange(
  deps: ResumeStoreDeps,
  resumeId: ResumeId,
): Promise<Revision> {
  const resume = await loadResume(deps.resumes, resumeId)
  assertMutable(resume)
  const chain = await liveRevisionChain(deps.resumes, resumeId)
  const position = cursorPosition(chain, resume.currentRevision)
  if (position < 0) throw cursorNotOnLiveChain(resumeId, [resume.currentRevision])
  const successor = position < chain.length - 1 ? chain[position + 1] : undefined
  if (successor === undefined) {
    throw new DomainError(
      'cursorNotOnLiveChain',
      'The cursor already sits on the newest revision; there is nothing to redo.',
      { entity: 'resume', id: resumeId, blockers: [] },
    )
  }
  await deps.resumes.moveCursor(resumeId, successor.id)
  return successor
}
