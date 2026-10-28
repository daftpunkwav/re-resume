/**
 * @file createResume
 * @description Creates one resume together with its initial revision. The
 * document starts as the template's defaults with one empty visible section per
 * built-in module, and an optional initial selection fills chapters before the
 * first write.
 *
 * Responsibilities:
 * - Validate the title, target job, template and initial selection
 * - Allocate the resume, revision and section identifiers
 * - Write the resume row and the revision it opens with as one unit
 *
 * Constraints:
 * - A resume the user creates by hand starts empty; seeding it with content is
 *   the caller's decision.
 * - The initial revision is part of the same transaction as the resume row: a
 *   resume whose cursor points at a revision that was never written cannot be
 *   hydrated.
 */

import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type {
  ConversationId,
  ResumeId,
  RevisionId,
  TemplateId,
} from '../../domain/shared/branded-id'
import { asResumeId, asResumeSectionId, asRevisionId } from '../../domain/shared/branded-id'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { ResumeDocumentState } from '../../domain/resume/DocumentState'
import type { ResumeSection } from '../../domain/resume/ResumeSection'
import { normalizeResumeTitle } from '../../domain/resume/Resume'
import type { Resume } from '../../domain/resume/Resume'
import { INITIAL_REVISION_LABEL } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import type { TargetJob } from '../../domain/resume/TargetJob'
import { normalizeTargetJob } from '../../domain/resume/TargetJob'
import type { TemplateDefinition } from '../../domain/resume/Template'
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  SIDEBAR_MODULE_KINDS,
} from '../../domain/resume/Template'
import { DomainError } from '../../domain/shared/DomainError'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta } from './resumeSource'
import type { SectionSelection } from './sectionSelection'
import { applySectionSelection } from './sectionSelection'

export interface CreateResumeInput extends ChangeProvenance {
  readonly title: string
  readonly targetJob?: TargetJob | null
  readonly templateId?: TemplateId
  readonly conversationId?: ConversationId | null
  /** Chapters the caller wants selected before the first revision. */
  readonly initialSelection?: readonly SectionSelection[]
}

export interface CreateResumeOutput {
  readonly resumeId: ResumeId
  readonly revisionId: RevisionId
}

export interface CreateResumeDeps extends ResumeStoreDeps {
  readonly entries: InfoEntryRepository
  readonly ids: IdGenerator
  readonly clock: Clock
}

export async function createResume(
  deps: CreateResumeDeps,
  input: CreateResumeInput,
): Promise<CreateResumeOutput> {
  const title = normalizeResumeTitle(input.title)
  const targetJob =
    input.targetJob === undefined || input.targetJob === null
      ? null
      : normalizeTargetJob(input.targetJob)
  const template = requireTemplate(input.templateId ?? DEFAULT_TEMPLATE_ID)
  const now = deps.clock.now()
  const resumeId = asResumeId(deps.ids.next())
  const revisionId = asRevisionId(deps.ids.next())

  let document = initialDocument(template, deps.ids)
  for (const selection of input.initialSelection ?? []) {
    document = await applySectionSelection(
      { entries: deps.entries },
      deps.ids,
      document,
      selection,
    )
  }

  const resume: Resume = {
    id: resumeId,
    title,
    targetJob,
    status: 'draft',
    document,
    currentRevision: revisionId,
    snapshots: [],
    conversationId: input.conversationId ?? null,
    createdAt: now,
    updatedAt: now,
  }
  const revision: Revision = {
    id: revisionId,
    resumeId,
    seq: 1,
    ...changeMeta(INITIAL_REVISION_LABEL, input),
    state: document,
    supersededAt: null,
    createdAt: now,
  }
  await deps.resumes.insertWithInitialRevision(resume, revision)
  return { resumeId, revisionId }
}

/**
 * The empty document a template starts a resume with: one visible section per
 * built-in module in the template's own chapter order, the template's appearance
 * and page defaults, and no overrides or free blocks.
 */
function initialDocument(template: TemplateDefinition, ids: IdGenerator): ResumeDocumentState {
  const sections: ResumeSection[] = template.defaultSectionOrder
    .filter((moduleKind) => moduleKind !== 'custom')
    .map((moduleKind, index) => ({
      id: asResumeSectionId(ids.next()),
    moduleKind,
    customModuleId: null,
    displayName: null,
    entryIds: [],
    visible: true,
    column: initialColumn(template.defaults.pageSetup.columns, moduleKind),
    sortOrder: index + 1,
  }))
  return {
    sections,
    overrides: [],
    templateId: template.id,
    appearance: template.defaults.appearance,
    pageSetup: template.defaults.pageSetup,
    canvas: { freeBlocks: [] },
  }
}

/** The column a fresh section starts in: sidebar modules start in column 1. */
function initialColumn(pageColumns: 1 | 2, moduleKind: InfoModuleKind): 1 | 2 {
  if (pageColumns === 1) return 1
  return SIDEBAR_MODULE_KINDS.has(moduleKind) ? 1 : 2
}

function requireTemplate(templateId: TemplateId): TemplateDefinition {
  const template = getTemplate(templateId)
  if (template === null) {
    throw new DomainError('templateNotFound', 'The selected template does not exist.', {
      entity: 'resume',
      id: templateId,
      blockers: [templateId],
    })
  }
  return template
}
