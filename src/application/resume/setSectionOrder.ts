/**
 * @file setSectionOrder
 * @description Reorders the resume's chapters. The request must name exactly the
 * sections the document has; a set that differs is refused rather than applied
 * against a different collection.
 *
 * Constraints:
 * - The change goes through `commitResumeChange`, so the new order is one
 *   revision and undo restores the previous order.
 */

import type { ResumeId, ResumeSectionId } from '../../domain/shared/branded-id'
import type { Revision } from '../../domain/resume/Revision'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'
import { reorderSections } from './sectionSelection'

export interface SetSectionOrderInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly orderedSectionIds: readonly ResumeSectionId[]
}

export interface SetSectionOrderOutput {
  readonly revision: Revision
}

export async function setSectionOrder(
  deps: ResumeStoreDeps,
  input: SetSectionOrderInput,
): Promise<SetSectionOrderOutput> {
  await loadResume(deps.resumes, input.resumeId)
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('调整章节顺序', input),
    next: (state) => reorderSections(state, input.orderedSectionIds),
  })
  return { revision }
}
