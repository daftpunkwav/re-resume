/**
 * @file undoResumeChange
 * @description Moves the resume cursor one step back along the live revision
 * chain. Undo creates nothing: it re-hydrates the resume from a revision that
 * already exists.
 *
 * Constraints:
 * - A frozen resume has no undo: its history is read-only.
 * - The predecessor is chosen on the live chain only; an abandoned branch is
 *   never reachable by undo.
 */

import { assertMutable } from '../../domain/resume/Resume'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeId } from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import type { ResumeStoreDeps } from './resumeSource'
import { loadResume } from './resumeSource'
import { cursorNotOnLiveChain, cursorPosition, liveRevisionChain } from './revisionChain'

export async function undoResumeChange(
  deps: ResumeStoreDeps,
  resumeId: ResumeId,
): Promise<Revision> {
  const resume = await loadResume(deps.resumes, resumeId)
  assertMutable(resume)
  const chain = await liveRevisionChain(deps.resumes, resumeId)
  const position = cursorPosition(chain, resume.currentRevision)
  if (position < 0) throw cursorNotOnLiveChain(resumeId, [resume.currentRevision])
  const predecessor = position > 0 ? chain[position - 1] : undefined
  if (predecessor === undefined) {
    throw new DomainError(
      'cursorNotOnLiveChain',
      'The cursor already sits on the initial revision; there is nothing earlier to undo.',
      { entity: 'resume', id: resumeId, blockers: [] },
    )
  }
  await deps.resumes.moveCursor(resumeId, predecessor.id)
  return predecessor
}
