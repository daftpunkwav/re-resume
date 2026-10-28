/**
 * @file setSectionDisplay
 * @description Changes how one chapter presents itself: its name, whether it is
 * visible, and which column it starts in. The underlying selection is untouched.
 *
 * Constraints:
 * - A name is 1..24 code points after trimming, or null for the module default.
 * - A column may not exceed the page's column count.
 * - The change goes through `commitResumeChange`, so each edit is one revision.
 */

import type { ResumeId, ResumeSectionId } from '../../domain/shared/branded-id'
import type { Revision } from '../../domain/resume/Revision'
import { normalizeSectionDisplayName, requireSection } from '../../domain/resume/ResumeSection'
import { DomainError } from '../../domain/shared/DomainError'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface SetSectionDisplayInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly sectionId: ResumeSectionId
  /** Undefined leaves the name unchanged; null restores the module default. */
  readonly displayName?: string | null
  readonly visible?: boolean
  readonly column?: 1 | 2
}

export interface SetSectionDisplayOutput {
  readonly revision: Revision
}

export async function setSectionDisplay(
  deps: ResumeStoreDeps,
  input: SetSectionDisplayInput,
): Promise<SetSectionDisplayOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  requireSection(resume.document.sections, input.sectionId)
  const displayName =
    input.displayName === undefined
      ? undefined
      : normalizeSectionDisplayName(input.displayName)
  if (input.column !== undefined && input.column > resume.document.pageSetup.columns) {
    throw new DomainError(
      'invalidFieldValue',
      'A section cannot be assigned to a column the page does not have.',
      { entity: 'resumeSection', id: input.sectionId, blockers: [input.sectionId] },
    )
  }
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta(labelOf(input), input),
    next: (state) => {
      const section = requireSection(state.sections, input.sectionId)
      return {
        ...state,
        sections: state.sections.map((candidate) =>
          candidate.id === section.id
            ? {
                ...section,
                displayName: displayName === undefined ? section.displayName : displayName,
                visible: input.visible ?? section.visible,
                column: input.column ?? section.column,
              }
            : candidate,
        ),
      }
    },
  })
  return { revision }
}

/** The history label describes the kind of edit the caller asked for. */
function labelOf(input: SetSectionDisplayInput): string {
  if (input.displayName !== undefined) return '重命名章节'
  if (input.visible !== undefined) return input.visible ? '显示章节' : '隐藏章节'
  return '调整章节栏位'
}
