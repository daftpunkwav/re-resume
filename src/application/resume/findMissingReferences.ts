/**
 * @file findMissingReferences
 * @description Reports every reference a resume document holds that no longer
 * resolves: selected entries, custom-module chapters, entry overrides, the
 * template and the target posting. The read path reports; it never repairs, and
 * a missing reference never makes rendering fail.
 *
 * Constraints:
 * - Read-only: no revision, no change record.
 * - The check covers every section, visible or not, so a hidden stale selection
 *   cannot slip into a freeze unnoticed.
 */

import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { JobPostingRepository } from '../../domain/generation/ports/JobPostingRepository'
import type { MissingReference } from '../../domain/resume/MissingReference'
import type { Resume } from '../../domain/resume/Resume'
import type { ResumeOverride } from '../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../domain/resume/ResumeSection'
import { getTemplate } from '../../domain/resume/Template'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { ResumeStoreDeps } from './resumeSource'
import { loadResume } from './resumeSource'

export interface FindMissingReferencesDeps extends ResumeStoreDeps {
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly jobPostings: JobPostingRepository
}

export interface FindMissingReferencesInput {
  readonly resumeId: ResumeId
}

export async function findMissingReferences(
  deps: FindMissingReferencesDeps,
  input: FindMissingReferencesInput,
): Promise<readonly MissingReference[]> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  return missingReferencesOf(deps, resume)
}

/**
 * The scan itself, shared with the freeze guard so a freeze decision and the
 * list the interface shows can never disagree.
 */
export async function missingReferencesOf(
  deps: FindMissingReferencesDeps,
  resume: Resume,
): Promise<readonly MissingReference[]> {
  const missing: MissingReference[] = []
  if (getTemplate(resume.document.templateId) === null) {
    missing.push({ kind: 'template', templateId: resume.document.templateId })
  }
  // One library read answers every selected identifier; asking per entry would
  // turn a report into one query per selected row.
  const [entries, customModules] = await Promise.all([
    deps.entries.listAll(),
    deps.customModules.listAll(),
  ])
  const entryIds = new Set<string>(entries.map((entry) => entry.id))
  const moduleIds = new Set<string>(customModules.map((module) => module.id))
  const sections = [...resume.document.sections].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  )
  for (const section of sections) {
    pushMissingCustomModule(section, moduleIds, missing)
    pushMissingEntries(section, entryIds, missing)
  }
  pushMissingOverrideTargets(resume.document.overrides, entryIds, missing)
  const jobPostingId = resume.targetJob?.jobPostingId ?? null
  if (jobPostingId !== null && (await deps.jobPostings.findById(jobPostingId)) === null) {
    missing.push({ kind: 'jobPosting', jobPostingId })
  }
  return missing
}

function pushMissingCustomModule(
  section: ResumeSection,
  moduleIds: ReadonlySet<string>,
  missing: MissingReference[],
): void {
  if (section.moduleKind !== 'custom') return
  if (section.customModuleId === null || moduleIds.has(section.customModuleId)) return
  missing.push({
    kind: 'customModule',
    moduleId: section.customModuleId,
    sectionId: section.id,
  })
}

function pushMissingEntries(
  section: ResumeSection,
  entryIds: ReadonlySet<string>,
  missing: MissingReference[],
): void {
  for (const entryId of section.entryIds) {
    if (!entryIds.has(entryId)) {
      missing.push({ kind: 'entry', entryId, sectionId: section.id })
    }
  }
}

function pushMissingOverrideTargets(
  overrides: readonly ResumeOverride[],
  entryIds: ReadonlySet<string>,
  missing: MissingReference[],
): void {
  for (const override of overrides) {
    if (override.target.kind !== 'entry') continue
    if (entryIds.has(override.target.entryId)) continue
    missing.push({
      kind: 'override',
      overrideId: override.id,
      entryId: override.target.entryId,
    })
  }
}
