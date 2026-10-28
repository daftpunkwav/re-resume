/**
 * @file deleteOverride
 * @description Removes one customised text from a resume. Deleting the override
 * returns the block to the library text; the entry itself never changes.
 */

import type { ResumeId, ResumeOverrideId } from '../../domain/shared/branded-id'
import type { Revision } from '../../domain/resume/Revision'
import { DomainError } from '../../domain/shared/DomainError'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface DeleteOverrideInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly overrideId: ResumeOverrideId
}

export interface DeleteOverrideOutput {
  readonly revision: Revision
}

export async function deleteOverride(
  deps: ResumeStoreDeps,
  input: DeleteOverrideInput,
): Promise<DeleteOverrideOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const exists = resume.document.overrides.some((override) => override.id === input.overrideId)
  if (!exists) {
    throw new DomainError('overrideNotFound', 'The customised text does not exist.', {
      entity: 'resumeOverride',
      id: input.overrideId,
      blockers: [input.overrideId],
    })
  }
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('删除定制文案', input),
    next: (state) => ({
      ...state,
      overrides: state.overrides.filter((override) => override.id !== input.overrideId),
    }),
  })
  return { revision }
}
