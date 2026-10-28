/**
 * @file removeSection
 * @description Removes one chapter from the resume. The entries it selected are
 * not touched: they are library values, and other chapters or resumes may still
 * select them.
 *
 * Constraints:
 * - The remaining chapters are renumbered densely, so the document invariant
 *   holds after every removal.
 * - The change goes through `commitResumeChange`; undo restores the chapter
 *   because the whole previous state is still in the chain.
 */

import type { ResumeId, ResumeSectionId } from '../../domain/shared/branded-id'
import type { Revision } from '../../domain/resume/Revision'
import { renumberSections, requireSection } from '../../domain/resume/ResumeSection'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface RemoveSectionInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly sectionId: ResumeSectionId
}

export interface RemoveSectionOutput {
  readonly revision: Revision
}

export async function removeSection(
  deps: ResumeStoreDeps,
  input: RemoveSectionInput,
): Promise<RemoveSectionOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  requireSection(resume.document.sections, input.sectionId)
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('删除章节', input),
    next: (state) => {
      requireSection(state.sections, input.sectionId)
      return {
        ...state,
        sections: renumberSections(
          state.sections.filter((section) => section.id !== input.sectionId),
        ),
      }
    },
  })
  return { revision }
}
