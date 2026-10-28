/**
 * @file fixtures.resume
 * @description The resumes the browser preview starts with, built against the
 * preview information library. One is a complete single-column draft; the other
 * demonstrates the second template, resume overrides, free canvas blocks and a
 * document whose references have gone stale.
 *
 * Constraints:
 * - Every fixture is validated by the same document validator the use cases run,
 *   so a preview can never show a state the real model rejects.
 * - Identifiers and timestamps are fixed: a preview session must look the same on
 *   every run.
 * - The fixtures are assembled here rather than through the use cases because
 *   the preview root needs the seeded store before the services exist.
 */

import { asAgentRunId, asCanvasBlockId, asCustomModuleId, asInfoEntryId, asJobPostingId, asResumeId, asResumeOverrideId, asResumeSectionId, asRevisionId } from '../../domain/shared/branded-id'
import type { InfoEntryId, ResumeId } from '../../domain/shared/branded-id'
import type { CanvasBlock } from '../../domain/resume/CanvasLayout'
import { validateResumeDocument } from '../../domain/resume/DocumentState'
import type { ResumeDocumentState } from '../../domain/resume/DocumentState'
import type { ResumeOverride } from '../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../domain/resume/ResumeSection'
import { CANONICAL_SECTION_ORDER } from '../../domain/resume/ResumeSection'
import type { Resume } from '../../domain/resume/Resume'
import type { Revision } from '../../domain/resume/Revision'
import { INITIAL_REVISION_LABEL } from '../../domain/resume/Revision'
import type { TargetJob } from '../../domain/resume/TargetJob'
import { getTemplate } from '../../domain/resume/Template'
import type { TemplateDefinition } from '../../domain/resume/Template'
import { asTemplateId } from '../../domain/shared/branded-id'
import type { SeededResume } from './inMemoryResumeRepository'
import { PREVIEW_EPOCH } from './deterministicEnvironment'
import { PREVIEW_CERTIFICATE_MODULE } from './fixtures.info'

/** Identifier of the single-column preview resume. */
export const PREVIEW_CLASSIC_RESUME_ID: ResumeId = asResumeId('preview-resume-classic')

/** Identifier of the two-column preview resume with overrides and free blocks. */
export const PREVIEW_TWO_COLUMN_RESUME_ID: ResumeId = asResumeId('preview-resume-two-column')

/** A library entry the second fixture selects but the library does not have. */
export const PREVIEW_MISSING_ENTRY_ID = asInfoEntryId('preview-education-missing')

/** A custom module the second fixture references after its definition is gone. */
export const PREVIEW_MISSING_MODULE_ID = asCustomModuleId('preview-module-missing')

const TITLE_CLASSIC = '后端开发工程师 · 林清越'
const TITLE_TWO_COLUMN = '产品方向 · 双栏样例'

function templateOf(id: string): TemplateDefinition {
  const template = getTemplate(asTemplateId(id))
  if (template === null) throw new Error(`The preview fixture template "${id}" is not registered.`)
  return template
}

function entryId(value: string): InfoEntryId {
  return asInfoEntryId(value)
}

interface SectionInput {
  readonly id: string
  readonly moduleKind: ResumeSection['moduleKind']
  readonly entryIds: readonly string[]
  readonly sortOrder: number
  readonly column?: 1 | 2
  readonly customModuleId?: string | null
  readonly displayName?: string | null
  readonly visible?: boolean
}

function section(input: SectionInput): ResumeSection {
  return {
    id: asResumeSectionId(input.id),
    moduleKind: input.moduleKind,
    customModuleId:
      input.customModuleId === undefined || input.customModuleId === null
        ? null
        : asCustomModuleId(input.customModuleId),
    displayName: input.displayName ?? null,
    entryIds: input.entryIds.map(entryId),
    visible: input.visible ?? true,
    column: input.column ?? 1,
    sortOrder: input.sortOrder,
  }
}

/** The eight built-in chapters in canonical order, plus the custom one. */
function classicSections(): readonly ResumeSection[] {
  const selections: Readonly<Record<string, readonly string[]>> = {
    personal: ['preview-personal-1'],
    jobIntent: ['preview-job-intent-1'],
    education: ['preview-education-1', 'preview-education-2'],
    internship: ['preview-internship-1', 'preview-internship-2'],
    project: ['preview-project-1', 'preview-project-2'],
    skill: ['preview-skill-1', 'preview-skill-2', 'preview-skill-3'],
    award: ['preview-award-1', 'preview-award-2'],
    selfEvaluation: ['preview-self-evaluation-1'],
  }
  const sections: ResumeSection[] = CANONICAL_SECTION_ORDER.filter(
    (kind) => kind !== 'custom',
  ).map((moduleKind, index) =>
    section({
      id: `preview-section-${moduleKind}`,
      moduleKind,
      entryIds: selections[moduleKind] ?? [],
      sortOrder: index + 1,
    }),
  )
  sections.push(
    section({
      id: 'preview-section-certificate',
      moduleKind: 'custom',
      customModuleId: PREVIEW_CERTIFICATE_MODULE.id,
      entryIds: ['preview-certificate-1', 'preview-certificate-2'],
      sortOrder: sections.length + 1,
    }),
  )
  return sections
}

function summaryOverride(text: string): ResumeOverride {
  return {
    id: asResumeOverrideId('preview-override-summary'),
    target: { kind: 'summary' },
    text,
    origin: 'user',
    sourceRunId: null,
    editedByUser: true,
    createdAt: PREVIEW_EPOCH,
    updatedAt: PREVIEW_EPOCH,
  }
}

function entryOverride(entry: string, text: string): ResumeOverride {
  return {
    id: asResumeOverrideId(`preview-override-${entry}`),
    target: { kind: 'entry', entryId: asInfoEntryId(entry) },
    text,
    origin: 'agent',
    sourceRunId: asAgentRunId('preview-run-1'),
    editedByUser: false,
    createdAt: PREVIEW_EPOCH,
    updatedAt: PREVIEW_EPOCH,
  }
}

function freeBlock(input: Omit<CanvasBlock, 'id'> & { readonly id: string }): CanvasBlock {
  return { ...input, id: asCanvasBlockId(input.id) }
}

function documentOf(
  templateId: string,
  sections: readonly ResumeSection[],
  overrides: readonly ResumeOverride[],
  freeBlocks: readonly CanvasBlock[],
  appearancePatch: Partial<ResumeDocumentState['appearance']> = {},
  pagePatch: Partial<ResumeDocumentState['pageSetup']> = {},
): ResumeDocumentState {
  const template = templateOf(templateId)
  const document: ResumeDocumentState = {
    sections,
    overrides,
    templateId: asTemplateId(templateId),
    appearance: { ...template.defaults.appearance, ...appearancePatch },
    pageSetup: { ...template.defaults.pageSetup, ...pagePatch },
    canvas: { freeBlocks },
  }
  validateResumeDocument(document)
  return document
}

function resume(
  id: ResumeId,
  title: string,
  document: ResumeDocumentState,
  targetJob: TargetJob | null,
): SeededResume {
  const revisionId = asRevisionId(`${id}-revision-1`)
  const resumeValue: Resume = {
    id,
    title,
    targetJob,
    status: 'draft',
    document,
    currentRevision: revisionId,
    snapshots: [],
    conversationId: null,
    createdAt: PREVIEW_EPOCH,
    updatedAt: PREVIEW_EPOCH,
  }
  const revision: Revision = {
    id: revisionId,
    resumeId: id,
    seq: 1,
    label: INITIAL_REVISION_LABEL,
    origin: 'user',
    runId: null,
    state: document,
    supersededAt: null,
    createdAt: PREVIEW_EPOCH,
  }
  return { resume: resumeValue, revision }
}

/** The classic draft: every built-in chapter populated plus the custom module. */
const classic = resume(
  PREVIEW_CLASSIC_RESUME_ID,
  TITLE_CLASSIC,
  documentOf(
    'classic-single',
    classicSections(),
    [
      summaryOverride(
        '三年后端开发经验，专注订单与结算链路。希望把可观测性和数据一致性带进新的团队。',
      ),
    ],
    [],
    { fontScale: 1.05 },
    {},
  ),
  { title: '后端开发工程师', company: '目标公司', jobPostingId: null },
)

/** The two-column sample with overrides, free blocks and stale references. */
const twoColumn = resume(
  PREVIEW_TWO_COLUMN_RESUME_ID,
  TITLE_TWO_COLUMN,
  documentOf(
    'two-column-sidebar',
    [
      section({
        id: 'preview-two-column-personal',
        moduleKind: 'personal',
        entryIds: ['preview-personal-1'],
        sortOrder: 1,
        column: 1,
      }),
      section({
        id: 'preview-two-column-job-intent',
        moduleKind: 'jobIntent',
        entryIds: ['preview-job-intent-1'],
        sortOrder: 2,
        column: 1,
      }),
      section({
        id: 'preview-two-column-skill',
        moduleKind: 'skill',
        entryIds: ['preview-skill-1', 'preview-skill-2'],
        sortOrder: 3,
        column: 1,
      }),
      section({
        id: 'preview-two-column-award',
        moduleKind: 'award',
        entryIds: ['preview-award-1'],
        sortOrder: 4,
        column: 1,
      }),
      section({
        id: 'preview-two-column-education',
        moduleKind: 'education',
        entryIds: [PREVIEW_MISSING_ENTRY_ID, 'preview-education-1'],
        sortOrder: 5,
        column: 2,
      }),
      section({
        id: 'preview-two-column-internship',
        moduleKind: 'internship',
        entryIds: ['preview-internship-1'],
        sortOrder: 6,
        column: 2,
      }),
      section({
        id: 'preview-two-column-project',
        moduleKind: 'project',
        entryIds: ['preview-project-1'],
        sortOrder: 7,
        column: 2,
      }),
      section({
        id: 'preview-two-column-missing-module',
        moduleKind: 'custom',
        customModuleId: PREVIEW_MISSING_MODULE_ID,
        entryIds: [],
        sortOrder: 8,
        column: 2,
      }),
    ],
    [
      summaryOverride('面向产品方向整理的一页简历，重点呈现项目决策与跨团队协作。'),
      entryOverride(
        'preview-project-1',
        '主导订单中台重构：把单体服务拆分为四个领域服务，迁移期零资损，核心链路吞吐提升 2.3 倍。',
      ),
    ],
    [
      freeBlock({
        id: 'preview-free-text',
        kind: 'text',
        pageIndex: 0,
        x: 380,
        y: 700,
        width: 110,
        height: 40,
        zIndex: 1,
        text: '扫码查看作品集',
        textStyle: null,
        attachmentId: null,
      }),
      freeBlock({
        id: 'preview-free-divider',
        kind: 'divider',
        pageIndex: 0,
        x: 72,
        y: 660,
        width: 200,
        height: 8,
        zIndex: 0,
        text: null,
        textStyle: null,
        attachmentId: null,
      }),
    ],
    { accentColor: 'teal' },
    {},
  ),
  { title: '产品经理', company: null, jobPostingId: asJobPostingId('preview-posting-missing') },
)

/** Both preview resumes, in list order. */
export const PREVIEW_RESUMES: readonly SeededResume[] = [classic, twoColumn]
