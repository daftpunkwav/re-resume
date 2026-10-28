/**
 * @file resumeFixtures
 * @description Builders for resume tests: a document assembled from the preview
 * information fixtures, a deterministic text measurer, and the in-memory
 * repository an application test needs. The fixture content is rich enough that
 * materialization and pagination exercise every module, override and free block
 * without a database or a font file.
 *
 * Constraints:
 * - Test support only. The same document validator the use cases run is applied
 *   to every assembled fixture, so an invalid builder fails while the test file
 *   loads rather than inside an unrelated assertion.
 * - Content values come from `fixtures.info.ts`, so a materialization test and a
 *   preview test agree on what the library holds.
 */

import {
  asAgentRunId,
  asAttachmentId,
  asCanvasBlockId,
  asInfoEntryId,
  asResumeId,
  asResumeOverrideId,
  asResumeSectionId,
  asRevisionId,
  asTemplateId,
} from '../../src/domain/shared/branded-id'
import type {
  CanvasBlockId,
  ResumeId,
  ResumeSectionId,
  TemplateId,
} from '../../src/domain/shared/branded-id'
import type { Attachment } from '../../src/domain/conversation/Attachment'
import type { InfoEntry } from '../../src/domain/info/InfoEntry'
import type { CustomModuleDefinition } from '../../src/domain/info/CustomModule'
import type { InfoModuleKind } from '../../src/domain/info/InfoModuleKind'
import type { CanvasBlock } from '../../src/domain/resume/CanvasLayout'
import type { ResumeDocumentState } from '../../src/domain/resume/DocumentState'
import { validateResumeDocument } from '../../src/domain/resume/DocumentState'
import type { Resume } from '../../src/domain/resume/Resume'
import type { ResumeOverride } from '../../src/domain/resume/ResumeOverride'
import type { ResumeSection } from '../../src/domain/resume/ResumeSection'
import { CANONICAL_SECTION_ORDER } from '../../src/domain/resume/ResumeSection'
import type { Revision } from '../../src/domain/resume/Revision'
import { INITIAL_REVISION_LABEL } from '../../src/domain/resume/Revision'
import type { TargetJob } from '../../src/domain/resume/TargetJob'
import type { TextStyle } from '../../src/domain/resume/TextStyle'
import type { TextMeasurer, TextRun } from '../../src/domain/resume/ports/TextMeasurer'
import { getTemplate } from '../../src/domain/resume/Template'
import type { Clock } from '../../src/domain/shared/Clock'
import type { DateTime } from '../../src/domain/shared/DateTime'
import type { IdGenerator } from '../../src/domain/shared/IdGenerator'
import { parseDateTime } from '../../src/domain/shared/DateTime'
import {
  PREVIEW_INFO_CUSTOM_MODULES,
  PREVIEW_INFO_ENTRIES,
} from '../../src/infrastructure/preview/fixtures.info'
import { InMemoryResumeRepository } from '../../src/infrastructure/preview/inMemoryResumeRepository'
import {
  InMemoryAttachmentRepository,
  InMemoryJobPostingRepository,
} from '../../src/infrastructure/preview/inMemoryConversationRepositories'
import {
  InMemoryChangeLogRepository,
  InMemoryCustomModuleRepository,
  InMemoryInfoEntryRepository,
} from '../../src/infrastructure/preview/inMemoryInfoRepositories'
import type { ResumeContentDeps } from '../../src/application/resume/resumeSource'

/** One instant for every fixture row, so assertions never depend on time. */
export const FIXTURE_TIME: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

/** The fixture library as the materializer consumes it. */
export function entriesMap(
  entries: readonly InfoEntry[] = PREVIEW_INFO_ENTRIES,
): ReadonlyMap<string, InfoEntry> {
  return new Map(entries.map((entry) => [entry.id, entry]))
}

/** The fixture custom modules as the materializer consumes them. */
export function modulesMap(): ReadonlyMap<string, CustomModuleDefinition> {
  return new Map(PREVIEW_INFO_CUSTOM_MODULES.map((module) => [module.id, module]))
}

/** Deterministic widths in points per character class, so lines and pages are exact. */
export class FixedWidthTextMeasurer implements TextMeasurer {
  constructor(
    private readonly latin = 6,
    private readonly wide = 11,
  ) {}

  measureLine(text: string, _style: TextStyle): number {
    let width = 0
    for (const char of text) width += isWide(char) ? this.wide : this.latin
    return width
  }

  measureClusters(text: string, _style: TextStyle): readonly number[] {
    return [...text].map((char) => (isWide(char) ? this.wide : this.latin))
  }

  resolveRuns(text: string, style: TextStyle): readonly TextRun[] {
    return [
      {
        text,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        width: this.measureLine(text, style),
        baselineShift: 0,
      },
    ]
  }
}

function isWide(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60)
  )
}

interface SectionInput {
  readonly moduleKind: InfoModuleKind
  readonly entryIds?: readonly string[]
  readonly displayName?: string | null
  readonly visible?: boolean
  readonly column?: 1 | 2
  readonly customModuleId?: CustomModuleDefinition['id'] | null
  readonly id?: string
  readonly sortOrder?: number
}

/** A section builder in canonical order when `sortOrder` is omitted. */
export function aSection(input: SectionInput): ResumeSection {
  const rank = CANONICAL_SECTION_ORDER.indexOf(input.moduleKind)
  return {
    id: asResumeSectionId(input.id ?? `section-${input.moduleKind}`) as ResumeSectionId,
    moduleKind: input.moduleKind,
    customModuleId: input.customModuleId ?? null,
    displayName: input.displayName ?? null,
    entryIds: (input.entryIds ?? []).map((entry) => asInfoEntryId(entry)),
    visible: input.visible ?? true,
    column: input.column ?? 1,
    sortOrder: input.sortOrder ?? rank + 1,
  }
}

/** Every built-in module populated from the preview library, plus the custom one. */
export function richSections(): readonly ResumeSection[] {
  const builtIn: readonly (readonly [InfoModuleKind, readonly string[]])[] = [
    ['personal', ['preview-personal-1']],
    ['jobIntent', ['preview-job-intent-1']],
    ['education', ['preview-education-1', 'preview-education-2']],
    ['internship', ['preview-internship-1', 'preview-internship-2']],
    ['project', ['preview-project-1', 'preview-project-2']],
    ['skill', ['preview-skill-1', 'preview-skill-2', 'preview-skill-3']],
    ['award', ['preview-award-1', 'preview-award-2']],
    ['selfEvaluation', ['preview-self-evaluation-1']],
  ]
  const sections = builtIn.map(([moduleKind, entryIds]) =>
    aSection({ moduleKind, entryIds }),
  )
  return [
    ...sections,
    aSection({
      moduleKind: 'custom',
      customModuleId: PREVIEW_INFO_CUSTOM_MODULES[0]?.id ?? null,
      entryIds: ['preview-certificate-1', 'preview-certificate-2'],
      sortOrder: sections.length + 1,
    }),
  ]
}

/** The default document: classic template, rich content, no overrides. */
export function aDocument(
  overrides: Partial<Omit<ResumeDocumentState, 'canvas'>> & {
    readonly freeBlocks?: readonly CanvasBlock[]
  } = {},
): ResumeDocumentState {
  const template = requireTemplate(overrides.templateId ?? asTemplateId('classic-single'))
  const document: ResumeDocumentState = {
    sections: overrides.sections ?? richSections(),
    overrides: overrides.overrides ?? [],
    templateId: overrides.templateId ?? template.id,
    appearance: overrides.appearance ?? template.defaults.appearance,
    pageSetup: overrides.pageSetup ?? template.defaults.pageSetup,
    canvas: { freeBlocks: overrides.freeBlocks ?? [] },
  }
  validateResumeDocument(document)
  return document
}

/** A two-column document on the sidebar template, with overrides and free blocks. */
export function aTwoColumnDocument(): ResumeDocumentState {
  const template = requireTemplate(asTemplateId('two-column-sidebar'))
  const sidebar = (moduleKind: InfoModuleKind, entryIds: readonly string[]): ResumeSection =>
    aSection({ moduleKind, entryIds, column: 1, id: `sidebar-${moduleKind}` })
  const main = (
    moduleKind: InfoModuleKind,
    entryIds: readonly string[],
    customModuleId: CustomModuleDefinition['id'] | null = null,
  ): ResumeSection =>
    aSection({ moduleKind, entryIds, column: 2, id: `main-${moduleKind}`, customModuleId })
  const sections: ResumeSection[] = [
    sidebar('personal', ['preview-personal-1']),
    sidebar('jobIntent', ['preview-job-intent-1']),
    sidebar('skill', ['preview-skill-1', 'preview-skill-2']),
    sidebar('award', ['preview-award-1']),
    main('education', ['preview-education-1']),
    main('internship', ['preview-internship-1']),
    main('project', ['preview-project-1']),
    main('custom', ['preview-certificate-1'], PREVIEW_INFO_CUSTOM_MODULES[0]?.id ?? null),
  ].map((section, index) => ({ ...section, sortOrder: index + 1 }))
  return aDocument({
    sections,
    templateId: template.id,
    pageSetup: template.defaults.pageSetup,
    appearance: template.defaults.appearance,
    overrides: [
      aSummaryOverride('面向岗位定制的总结。'),
      anEntryOverride('preview-project-1', '改写后的项目描述。'),
    ],
    freeBlocks: [aTextBlock('free-text', { x: 380, y: 680 }), aDividerBlock('free-divider')],
  })
}

/** A user-written summary override. */
export function aSummaryOverride(text = '岗位总结。'): ResumeOverride {
  return {
    id: asResumeOverrideId('override-summary'),
    target: { kind: 'summary' },
    text,
    origin: 'user',
    sourceRunId: null,
    editedByUser: true,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

/** An agent-written entry override. */
export function anEntryOverride(entryId: string, text = '改写文案。'): ResumeOverride {
  return {
    id: asResumeOverrideId(`override-${entryId}`),
    target: { kind: 'entry', entryId: asInfoEntryId(entryId) },
    text,
    origin: 'agent',
    sourceRunId: asAgentRunId('run-fixture'),
    editedByUser: false,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

/** A free text block, inside the A4 page. */
export function aTextBlock(
  id: string,
  box: {
    readonly x: number
    readonly y: number
    readonly width?: number
    readonly height?: number
  } = { x: 72, y: 700 },
): CanvasBlock {
  return {
    id: asCanvasBlockId(id) as CanvasBlockId,
    kind: 'text',
    pageIndex: 0,
    x: box.x,
    y: box.y,
    width: box.width ?? 120,
    height: box.height ?? 30,
    zIndex: 0,
    text: '画布文字',
    textStyle: null,
    attachmentId: null,
  }
}

/** A free divider block. */
export function aDividerBlock(id: string): CanvasBlock {
  return {
    id: asCanvasBlockId(id),
    kind: 'divider',
    pageIndex: 0,
    x: 72,
    y: 640,
    width: 200,
    height: 8,
    zIndex: 1,
    text: null,
    textStyle: null,
    attachmentId: null,
  }
}

/** A resume value plus the initial revision that names its cursor. */
export interface SeededResumeFixture {
  readonly resume: Resume
  readonly revision: Revision
}

export function aResume(
  options: {
    readonly id?: string
    readonly title?: string
    readonly status?: Resume['status']
    readonly document?: ResumeDocumentState
    readonly targetJob?: TargetJob | null
    readonly snapshots?: Resume['snapshots']
  } = {},
): SeededResumeFixture {
  const id = asResumeId(options.id ?? 'resume-fixture')
  const revisionId = asRevisionId(`${id}-revision-1`)
  const document = options.document ?? aDocument()
  const resume: Resume = {
    id,
    title: options.title ?? '测试简历',
    targetJob: options.targetJob ?? null,
    status: options.status ?? 'draft',
    document,
    currentRevision: revisionId,
    snapshots: options.snapshots ?? [],
    conversationId: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
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
    createdAt: FIXTURE_TIME,
  }
  return { resume, revision }
}

/** A deterministic clock: one second per read, starting from the fixture instant. */
export class TestClock implements Clock {
  #ticks = 0

  constructor(private readonly start: DateTime = FIXTURE_TIME) {}

  now(): DateTime {
    this.#ticks += 1
    const next = new Date(this.start)
    next.setTime(new Date(this.start).getTime() + (this.#ticks - 1) * 1000)
    return next.toISOString() as DateTime
  }
}

/** Readable ids, so a failure names the row it came from. */
export class TestIds implements IdGenerator {
  #next = 1

  constructor(private readonly prefix = 'test') {}

  next(): string {
    const value = `${this.prefix}-${this.#next}`
    this.#next += 1
    return value
  }
}

/** A store pre-loaded with one resume, ready for a use case test. */
export class TestResumeStore {
  readonly clock: TestClock
  readonly ids: TestIds
  readonly repository: InMemoryResumeRepository

  constructor(private readonly fixture: SeededResumeFixture = aResume()) {
    this.clock = new TestClock()
    this.ids = new TestIds()
    this.repository = new InMemoryResumeRepository(this.clock)
    this.repository.seed([fixture])
  }

  get resume(): Resume {
    return this.fixture.resume
  }

  get resumeId(): ResumeId {
    return this.fixture.resume.id
  }

  get revisionId(): string {
    return this.fixture.revision.id
  }
}

/** The information library the resume use cases read, seeded with the fixtures. */
export class TestLibrary {
  readonly changes: InMemoryChangeLogRepository
  readonly entries: InMemoryInfoEntryRepository
  readonly customModules: InMemoryCustomModuleRepository

  constructor() {
    this.changes = new InMemoryChangeLogRepository()
    this.entries = new InMemoryInfoEntryRepository(this.changes)
    this.customModules = new InMemoryCustomModuleRepository(this.entries, this.changes)
    this.entries.seed(PREVIEW_INFO_ENTRIES)
    this.customModules.seed(PREVIEW_INFO_CUSTOM_MODULES)
  }
}

/** The content dependencies a query or freeze test needs. */
export function contentDeps(
  store: TestResumeStore,
  library: TestLibrary = new TestLibrary(),
): ResumeContentDeps & { readonly library: TestLibrary } {
  return {
    resumes: store.repository,
    entries: library.entries,
    customModules: library.customModules,
    measurer: new FixedWidthTextMeasurer(),
    library,
  }
}

/** The reference dependencies the missing-reference query and freeze need. */
export function referenceDeps(
  store: TestResumeStore,
  library: TestLibrary = new TestLibrary(),
): ResumeContentDeps & {
  readonly library: TestLibrary
  readonly jobPostings: InMemoryJobPostingRepository
} {
  return {
    ...contentDeps(store, library),
    jobPostings: new InMemoryJobPostingRepository(),
  }
}

/** A stored attachment row, for the canvas image cases. */
export function anAttachment(id: string): Attachment {
  return {
    id: asAttachmentId(id),
    kind: 'image',
    mimeType: 'image/png',
    byteSize: 1024,
    storageName: `${id}.png`,
    width: 640,
    height: 480,
    sha256: 'a'.repeat(64),
    createdAt: FIXTURE_TIME,
  }
}

/** An attachment store holding exactly the given rows. */
export function attachmentStore(ids: readonly string[] = []): InMemoryAttachmentRepository {
  return new InMemoryAttachmentRepository(ids.map(anAttachment))
}

function requireTemplate(id: TemplateId) {
  const template = getTemplate(id)
  if (template === null) throw new Error(`The fixture template "${id}" is not registered.`)
  return template
}
