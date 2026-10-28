/**
 * @file commitResumeChange
 * @description The single entry point allowed to change a resume's document.
 * Every mutation — panel edit, canvas gesture, agent tool call — arrives here as
 * a change function and leaves as one revision.
 *
 * Execution order is the contract (spec section 5.8):
 * 1. load the resume → `resumeNotFound`
 * 2. refuse a frozen resume → `resumeFrozen`
 * 3. apply the pure change function
 * 4. validate the produced document
 * 5. persist through the repository, which supersedes, appends, moves the
 *    cursor and trims in one transaction (`revisionMismatch` on a stale cursor)
 *
 * Constraints:
 * - Missing references are deliberately not checked here: a change that removes
 *   a dangling reference must be committable, or the reference could never be
 *   cleared.
 * - Nothing is written when the change throws or the validation refuses.
 */

import type { DocumentChange } from '../../domain/resume/DocumentState'
import { validateResumeDocument } from '../../domain/resume/DocumentState'
import { assertMutable } from '../../domain/resume/Resume'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { ResumeStoreDeps } from './resumeSource'
import { loadResume } from './resumeSource'

export async function commitResumeChange(
  deps: ResumeStoreDeps,
  resumeId: ResumeId,
  change: DocumentChange,
): Promise<Revision> {
  const resume = await loadResume(deps.resumes, resumeId)
  assertMutable(resume)
  const state = change.next(resume.document)
  validateResumeDocument(state)
  return deps.resumes.saveDocument(resumeId, state, change, resume.currentRevision)
}
