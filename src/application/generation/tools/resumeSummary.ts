/**
 * @file resumeSummary
 * @description The compact, model-facing view of one resume: its metadata, the
 * selected chapters with their entry titles, the tailored overrides, the missing
 * references and the free-block count. The read tool and the prompt context both
 * consume it, so they can never describe the document differently.
 *
 * Responsibilities:
 * - Read the aggregate, the library and the posting references once
 * - Derive the selected entry titles per chapter
 * - Report the identifiers a tool result must name for undo
 *
 * Constraints:
 * - Read-only: no revision, no change record, no write through a repository that
 *   also appends history.
 * - Missing entries are reported as missing references and left out of the title
 *   list; the read path never repairs the document.
 */

import type { MissingReference } from '../../../domain/resume/MissingReference'
import type { AppearanceSettings } from '../../../domain/resume/AppearanceSettings'
import type { PageSetup } from '../../../domain/resume/PageSetup'
import type { Resume } from '../../../domain/resume/Resume'
import type { OverrideTarget } from '../../../domain/resume/ResumeOverride'
import type { ResumeStatus } from '../../../domain/resume/Resume'
import type { TargetJob } from '../../../domain/resume/TargetJob'
import type { TextMeasurer } from '../../../domain/resume/ports/TextMeasurer'
import type { ResumeRepository } from '../../../domain/resume/ports/ResumeRepository'
import type { InfoEntryRepository } from '../../../domain/info/ports/InfoEntryRepository'
import type { CustomModuleRepository } from '../../../domain/info/ports/CustomModuleRepository'
import type { JobPostingRepository } from '../../../domain/generation/ports/JobPostingRepository'
import type { InfoModuleKind } from '../../../domain/info/InfoModuleKind'
import type {
  ConversationId,
  CustomModuleId,
  InfoEntryId,
  ResumeId,
  ResumeSectionId,
  TemplateId,
} from '../../../domain/shared/branded-id'
import type { ResumeOverrideId } from '../../../domain/shared/branded-id'
import { DomainError } from '../../../domain/shared/DomainError'
import { missingReferencesOf } from '../../resume/findMissingReferences'

export interface ResumeSummarySection {
  readonly sectionId: ResumeSectionId
  readonly moduleKind: InfoModuleKind
  readonly customModuleId: CustomModuleId | null
  readonly displayName: string | null
  readonly visible: boolean
  readonly entryIds: readonly InfoEntryId[]
}

export interface ResumeSummaryOverride {
  readonly overrideId: ResumeOverrideId
  readonly target: OverrideTarget
  readonly text: string
  readonly origin: string
  readonly editedByUser: boolean
}

export interface ResumeSummarySelectedTitles {
  readonly sectionId: ResumeSectionId
  readonly titles: readonly string[]
}

/** The shape the tool contract fixes for `getResume` (spec section 7.4). */
export interface ResumeSummary {
  readonly resumeId: ResumeId
  readonly title: string
  readonly status: ResumeStatus
  readonly targetJob: TargetJob | null
  readonly templateId: TemplateId
  readonly appearance: AppearanceSettings
  readonly pageSetup: PageSetup
  readonly sections: readonly ResumeSummarySection[]
  readonly overrides: readonly ResumeSummaryOverride[]
  readonly missingReferences: readonly MissingReference[]
  readonly freeBlockCount: number
  readonly selectedEntryTitles: readonly ResumeSummarySelectedTitles[]
}

export interface ResumeSummaryDeps {
  readonly resumes: ResumeRepository
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly jobPostings: JobPostingRepository
  /** Optional: only the layout queries need it, not the summary itself. */
  readonly measurer?: TextMeasurer
}

/** Loads one resume or refuses with the contract's code. */
async function loadSummaryResume(
  deps: ResumeSummaryDeps,
  resumeId: ResumeId,
): Promise<Resume> {
  const resume = await deps.resumes.findById(resumeId)
  if (resume === null) {
    throw new DomainError('resumeNotFound', 'The resume does not exist.', {
      entity: 'resume',
      id: resumeId,
      blockers: [resumeId],
    })
  }
  return resume
}

/**
 * Finds the resume a turn is about: the one the caller named, the one the
 * conversation focuses on, or the newest resume created in this conversation.
 */
export async function findActiveResume(
  deps: Pick<ResumeSummaryDeps, 'resumes'>,
  conversationId: ConversationId,
  preferredResumeId: ResumeId | null,
  conversationResumeId: ResumeId | null,
): Promise<Resume | null> {
  const named = preferredResumeId ?? conversationResumeId
  if (named !== null) return deps.resumes.findById(named)
  const candidates = (await deps.resumes.listAll()).filter(
    (resume) => resume.conversationId === conversationId,
  )
  const newest = candidates.sort((left, right) =>
    left.updatedAt === right.updatedAt
      ? right.id.localeCompare(left.id)
      : right.updatedAt.localeCompare(left.updatedAt),
  )[0]
  return newest ?? null
}

/** Builds the summary from the stored aggregate. */
export async function buildResumeSummary(
  deps: ResumeSummaryDeps,
  resumeId: ResumeId,
): Promise<ResumeSummary> {
  return summarizeResume(deps, await loadSummaryResume(deps, resumeId))
}

export async function summarizeResume(
  deps: ResumeSummaryDeps,
  resume: Resume,
): Promise<ResumeSummary> {
  const [entries, missingReferences] = await Promise.all([
    deps.entries.listAll(),
    missingReferencesOf(deps, resume),
  ])
  const titlesById = new Map(entries.map((entry) => [entry.id as string, entry.title]))
  const selectedEntryTitles = resume.document.sections.map((section) => ({
    sectionId: section.id,
    titles: section.entryIds
      .map((entryId) => titlesById.get(entryId))
      .filter((title): title is string => title !== undefined),
  }))
  return {
    resumeId: resume.id,
    title: resume.title,
    status: resume.status,
    targetJob: resume.targetJob,
    templateId: resume.document.templateId,
    appearance: resume.document.appearance,
    pageSetup: resume.document.pageSetup,
    sections: resume.document.sections.map((section) => ({
      sectionId: section.id,
      moduleKind: section.moduleKind,
      customModuleId: section.customModuleId,
      displayName: section.displayName,
      visible: section.visible,
      entryIds: section.entryIds,
    })),
    overrides: resume.document.overrides.map((override) => ({
      overrideId: override.id,
      target: override.target,
      text: override.text,
      origin: override.origin,
      editedByUser: override.editedByUser,
    })),
    missingReferences,
    freeBlockCount: resume.document.canvas.freeBlocks.length,
    selectedEntryTitles,
  }
}
