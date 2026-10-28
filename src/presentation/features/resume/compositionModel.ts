/**
 * @file compositionModel
 * @description The derived lists the composition tab renders: sorted chapters,
 * the library lookup maps, the modules that can still become chapters, the
 * overrides and the open picker's chapter. Pure derivation; no state writes.
 */

import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { Resume } from '../../../domain/resume/Resume'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import type { ResumeSectionId } from '../../../domain/shared/branded-id'
import { selectableModules } from './resumeFormat'
import type { StudioSelection } from './resumeStore'

export interface CompositionModel {
  readonly entriesById: ReadonlyMap<string, InfoEntry>
  readonly customModulesById: ReadonlyMap<string, CustomModuleDefinition>
  readonly sections: readonly ResumeSection[]
  readonly availableModules: ReturnType<typeof selectableModules>
  readonly overrides: readonly ResumeOverride[]
  readonly busy: boolean
  readonly selectedSectionId: ResumeSectionId | null
  readonly pickerSection: ResumeSection | null
}

function sortedSections(resume: Resume | null): readonly ResumeSection[] {
  if (resume === null) return []
  return [...resume.document.sections].sort((left, right) => left.sortOrder - right.sortOrder)
}

function existingModuleKeys(sections: readonly ResumeSection[]): ReadonlySet<string> {
  return new Set(
    sections.map((section) => `${section.moduleKind}:${section.customModuleId ?? ''}`),
  )
}

function selectedSectionOf(selection: StudioSelection): ResumeSectionId | null {
  return selection.kind === 'section' ? selection.sectionId : null
}

function pickerSectionOf(
  sections: readonly ResumeSection[],
  pickerSectionId: string | null,
): ResumeSection | null {
  if (pickerSectionId === null) return null
  return sections.find((section) => section.id === pickerSectionId) ?? null
}

export function compositionModelOf(
  resume: Resume | null,
  entries: readonly InfoEntry[],
  customModules: readonly CustomModuleDefinition[],
  selection: StudioSelection,
  pickerSectionId: string | null,
  committing: boolean,
): CompositionModel {
  const sections = sortedSections(resume)
  const existing = existingModuleKeys(sections)
  const available = selectableModules(customModules).filter(
    (module) => !existing.has(`${module.moduleKind}:${module.customModuleId ?? ''}`),
  )
  return {
    entriesById: new Map(entries.map((entry) => [entry.id, entry])),
    customModulesById: new Map(customModules.map((module) => [module.id, module])),
    sections,
    availableModules: available,
    overrides: resume?.document.overrides ?? [],
    busy: resume?.status === 'frozen' || committing,
    selectedSectionId: selectedSectionOf(selection),
    pickerSection: pickerSectionOf(sections, pickerSectionId),
  }
}
