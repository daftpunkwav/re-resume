/**
 * @file InfoEntryReferenceQuery
 * @description Asks which resume sections currently reference a library entry or
 * a custom module. Deletion protection needs that answer, but the information
 * domain must not import the resume model: this consumer-owned port states the
 * question in the library's terms, and the resume side answers it.
 *
 * Constraints:
 * - Cross-context port: declared where it is consumed (spec section 2.2).
 * - Read-only: deletions do not touch the resumes that referenced the row; the
 *   resume reports the reference as missing instead.
 */

import type { CustomModuleId, InfoEntryId, ResumeId, ResumeSectionId } from '../../shared/branded-id'

/** One place a library value is referenced from. */
export interface InfoEntryReference {
  readonly resumeId: ResumeId
  readonly resumeTitle: string
  readonly sectionId: ResumeSectionId
}

export interface InfoEntryReferenceQuery {
  /** Resumes whose sections select the entry. */
  listEntryReferences(entryId: InfoEntryId): Promise<readonly InfoEntryReference[]>
  /** Resumes whose sections reference the custom module itself. */
  listModuleReferences(moduleId: CustomModuleId): Promise<readonly InfoEntryReference[]>
}
