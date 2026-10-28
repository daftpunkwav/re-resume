/**
 * @file ResumeEntryReferences
 * @description Answers the information library's delete-protection question by
 * scanning the resume documents that select the entry or reference the custom
 * module. The library must not import the resume model, and the resume side must
 * not write the library; this adapter is the single bridge.
 *
 * Constraints:
 * - Read-only: deleting a library value never rewrites a resume, it makes the
 *   selection a missing reference.
 * - Scans every resume document. The list is small (one row per resume) and the
 *   question is asked only when the user deletes a library value, so a denormalised
 *   reference table would add write cost for a rare read.
 */

import type { Resume } from '../../../domain/resume/Resume'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import type {
  InfoEntryReference,
  InfoEntryReferenceQuery,
} from '../../../domain/info/ports/InfoEntryReferenceQuery'
import type { ResumeRepository } from '../../../domain/resume/ports/ResumeRepository'
import type { CustomModuleId, InfoEntryId } from '../../../domain/shared/branded-id'

export class ResumeEntryReferences implements InfoEntryReferenceQuery {
  readonly #resumes: ResumeRepository

  constructor(resumes: ResumeRepository) {
    this.#resumes = resumes
  }

  async listEntryReferences(entryId: InfoEntryId): Promise<readonly InfoEntryReference[]> {
    return this.#find((resume) =>
      resume.document.sections.find((section) => section.entryIds.includes(entryId)),
    )
  }

  async listModuleReferences(moduleId: CustomModuleId): Promise<readonly InfoEntryReference[]> {
    return this.#find((resume) =>
      resume.document.sections.find((section) => section.customModuleId === moduleId),
    )
  }

  async #find(
    sectionOf: (resume: Resume) => ResumeSection | undefined,
  ): Promise<readonly InfoEntryReference[]> {
    const resumes = await this.#resumes.listAll()
    const references: InfoEntryReference[] = []
    for (const resume of resumes) {
      const section = sectionOf(resume)
      if (section === undefined) continue
      references.push({
        resumeId: resume.id,
        resumeTitle: resume.title,
        sectionId: section.id,
      })
    }
    return references
  }
}
