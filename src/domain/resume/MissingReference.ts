/**
 * @file MissingReference
 * @description A reference a resume document holds that no longer resolves. The
 * model keeps references by identifier on purpose, so deleting a library value
 * never silently rewrites a saved resume; the gap is reported by
 * `findMissingReferences` and rendered as a placeholder, and freezing is
 * refused while one exists.
 *
 * Constraints:
 * - Pure data: no DOM, no storage, no package.
 * - A missing reference never makes rendering fail; it changes what is drawn.
 */

import type {
  CustomModuleId,
  InfoEntryId,
  JobPostingId,
  ResumeOverrideId,
  ResumeSectionId,
  TemplateId,
} from '../shared/branded-id'

export type MissingReference =
  | { readonly kind: 'entry'; readonly entryId: InfoEntryId; readonly sectionId: ResumeSectionId }
  | {
      readonly kind: 'customModule'
      readonly moduleId: CustomModuleId
      readonly sectionId: ResumeSectionId
    }
  | { readonly kind: 'override'; readonly overrideId: ResumeOverrideId; readonly entryId: InfoEntryId }
  | { readonly kind: 'template'; readonly templateId: TemplateId }
  | { readonly kind: 'jobPosting'; readonly jobPostingId: JobPostingId }
