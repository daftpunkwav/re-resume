/**
 * @file setAppearance
 * @description Patches the look of one resume. Every value is merged over the
 * current appearance and validated by the domain's closed bounds, so a partial
 * patch can never leave the document in an illegal state.
 *
 * Constraints:
 * - Out-of-range or unknown values are refused with `invalidSettings`.
 * - One revision per accepted change; undo restores the previous appearance.
 */

import type { AppearanceSettings } from '../../domain/resume/AppearanceSettings'
import { mergeAppearance } from '../../domain/resume/AppearanceSettings'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface SetAppearanceInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly patch: Partial<AppearanceSettings>
}

export interface SetAppearanceOutput {
  readonly revision: Revision
}

export async function setAppearance(
  deps: ResumeStoreDeps,
  input: SetAppearanceInput,
): Promise<SetAppearanceOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  // Validate against the current value before writing, so a refused patch never
  // reaches the repository.
  mergeAppearance(resume.document.appearance, input.patch)
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('调整外观', input),
    next: (state) => ({
      ...state,
      appearance: mergeAppearance(state.appearance, input.patch),
    }),
  })
  return { revision }
}
