/**
 * @file setSectionSelection
 * @description Selects the library entries one resume chapter renders, in the
 * order they render. A chapter that does not exist yet is created at its
 * canonical position; an existing one keeps its identifier, name, visibility
 * and column.
 *
 * Constraints:
 * - Every selected entry is checked against the library on write, including its
 *   module association; the read path tolerates stale references instead.
 * - The change goes through `commitResumeChange`, so it produces one revision.
 */

import type { CustomModuleId, InfoEntryId, ResumeSectionId, ResumeId } from '../../domain/shared/branded-id'
import { asResumeSectionId } from '../../domain/shared/branded-id'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { Revision } from '../../domain/resume/Revision'
import { sectionKey } from '../../domain/resume/ResumeSection'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'
import type { SectionSelection } from './sectionSelection'
import { selectSection, validateSelection } from './sectionSelection'

export interface SetSectionSelectionInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly moduleKind: InfoModuleKind
  readonly customModuleId?: CustomModuleId | null
  readonly entryIds: readonly InfoEntryId[]
}

export interface SetSectionSelectionDeps extends ResumeStoreDeps {
  readonly entries: InfoEntryRepository
  readonly ids: IdGenerator
}

export interface SetSectionSelectionOutput {
  readonly sectionId: ResumeSectionId
  readonly revision: Revision
}

export async function setSectionSelection(
  deps: SetSectionSelectionDeps,
  input: SetSectionSelectionInput,
): Promise<SetSectionSelectionOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const selection: SectionSelection = {
    moduleKind: input.moduleKind,
    customModuleId: input.customModuleId ?? null,
    entryIds: input.entryIds,
  }
  await validateSelection({ entries: deps.entries }, selection)
  const key = sectionKey(selection.moduleKind, selection.customModuleId ?? null)
  const exists = resume.document.sections.some(
    (section) => sectionKey(section.moduleKind, section.customModuleId) === key,
  )
  const newSectionId = exists ? null : asResumeSectionId(deps.ids.next())
  const nextState = selectSection(resume.document, selection, newSectionId)
  const section = nextState.sections.find(
    (candidate) => sectionKey(candidate.moduleKind, candidate.customModuleId) === key,
  )
  if (section === undefined) {
    throw new Error('The selected section is missing from the produced document.')
  }
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('选择条目', input),
    next: (state) => selectSection(state, selection, newSectionId),
  })
  return { sectionId: section.id, revision }
}
