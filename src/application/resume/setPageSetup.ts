/**
 * @file setPageSetup
 * @description Patches paper, margins, columns and page numbering for one
 * resume. The merged setup is validated against the template that will render
 * it, so a page can never declare a column count or content box the template
 * cannot produce.
 *
 * Constraints:
 * - Refusals are `invalidPageSetup`; a free block that no longer fits the new
 *   page is refused with `canvasBlockOutOfBounds` by the document validator.
 * - One revision per accepted change; undo restores the previous page.
 */

import type { PageSetup } from '../../domain/resume/PageSetup'
import { mergePageSetup, validatePageSetup } from '../../domain/resume/PageSetup'
import { resolveTemplate } from '../../domain/resume/Template'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface SetPageSetupInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly patch: Partial<PageSetup>
}

export interface SetPageSetupOutput {
  readonly revision: Revision
}

export async function setPageSetup(
  deps: ResumeStoreDeps,
  input: SetPageSetupInput,
): Promise<SetPageSetupOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  // Validate the merged result before writing, so a refused patch never reaches
  // the repository.
  validatePageSetup(
    mergePageSetup(resume.document.pageSetup, input.patch),
    resolveTemplate(resume.document.templateId),
  )
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('调整页面', input),
    next: (state) => {
      const pageSetup = mergePageSetup(state.pageSetup, input.patch)
      validatePageSetup(pageSetup, resolveTemplate(state.templateId))
      return { ...state, pageSetup }
    },
  })
  return { revision }
}
