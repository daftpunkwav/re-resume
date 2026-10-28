/**
 * @file resumeStore
 * @description The resume studio's one store: the list, the selected document,
 * the materialized content and layout the canvas draws, the revision chain for
 * undo/redo, and the view state the studio shares between its regions (zoom,
 * page, selection, inline editor target, agent highlight).
 *
 * Responsibilities:
 * - Load the resume list and the selected render, and keep them after a write
 * - Route every document edit to one application use case, then re-read the
 *   rendered document so the canvas, the composition panel and the revision
 *   label cannot disagree
 * - Guard edits against a frozen resume and against overlapping writes
 * - Own canvas view requests (`fitWidth`, `scrollToSection`) for the viewport
 *
 * Constraints:
 * - This module never imports a repository or measures text itself: every
 *   value comes from `ResumeService`/`InfoService` or from a domain helper.
 * - A request that was superseded (another resume selected meanwhile) must not
 *   write. Every loader checks the store's epoch before committing its value.
 */

import { create } from 'zustand'

import type { InfoService, ResumeRender, ResumeService } from '../../../bootstrap/capabilities'
import type {
  AppearanceSettings,
} from '../../../domain/resume/AppearanceSettings'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { InfoModuleKind } from '../../../domain/info/InfoModuleKind'
import type { CanvasBlock } from '../../../domain/resume/CanvasLayout'
import type { LayoutBlockId } from '../../../domain/shared/branded-id'
import type { LayoutOutput } from '../../../domain/resume/PageLayout'
import type { PageSetup } from '../../../domain/resume/PageSetup'
import type { Resume } from '../../../domain/resume/Resume'
import type { MaterializedDocument } from '../../../domain/resume/ResumeSnapshot'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../../domain/resume/ResumeSection'
import type { Revision } from '../../../domain/resume/Revision'
import type { TemplateDefinition } from '../../../domain/resume/Template'
import { listTemplates } from '../../../domain/resume/Template'
import { clampCanvasZoom } from '../../../domain/settings/AppSettings'
import type {
  CanvasBlockId,
  InfoEntryId,
  ResumeId,
  ResumeOverrideId,
  ResumeSectionId,
  RevisionId,
} from '../../../domain/shared/branded-id'
import type { ResolvedStyles } from '../../../application/resume/materializeDocument'
import { resolveStyles } from '../../../application/resume/materializeDocument'
import { describeError } from '../../app/errorMessages'
import type { ReadableError } from '../../app/errorMessages'

/** The services the studio calls. Bound once per open panel by `attach`. */
export interface ResumeStudioServices {
  readonly resume: ResumeService
  readonly info: InfoService
}

export const STUDIO_TABS = ['composition', 'appearance', 'page'] as const
export type StudioTab = (typeof STUDIO_TABS)[number]

/** What is selected on the canvas: nothing, one flow/section block, or a chapter. */
export type StudioSelection =
  | { readonly kind: 'document' }
  | { readonly kind: 'block'; readonly blockId: LayoutBlockId }
  | { readonly kind: 'section'; readonly sectionId: ResumeSectionId }

/**
 * The inline editor's target. `text` is the starting value: the existing
 * override for a summary or entry, the block's text for a free block, or the
 * currently rendered body when no override exists yet.
 */
export type StudioEditorTarget =
  | {
      readonly kind: 'freeText'
      readonly layoutBlockId: LayoutBlockId
      readonly blockId: CanvasBlockId
      readonly text: string
    }
  | {
      readonly kind: 'summary'
      readonly layoutBlockId: LayoutBlockId
      readonly text: string
    }
  | {
      readonly kind: 'entryOverride'
      readonly layoutBlockId: LayoutBlockId
      readonly entryId: InfoEntryId
      readonly sectionId: ResumeSectionId
      readonly text: string
    }

export interface PageRequest {
  readonly pageIndex: number
  readonly nonce: number
}

export interface SectionRequest {
  readonly sectionId: ResumeSectionId
  readonly nonce: number
}

/** One agent write to reveal: the resume, the revision it produced, one delivery. */
export interface ResumeRevealRequest {
  readonly resumeId: ResumeId
  readonly revisionId: RevisionId | null
  readonly nonce: number
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
type ListStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ResumeStudioState {
  readonly services: ResumeStudioServices | null
  /** Increments whenever the selected resume or the services change. */
  readonly epoch: number

  readonly list: readonly Resume[]
  readonly listStatus: ListStatus
  readonly listError: ReadableError | null

  readonly selectedId: ResumeId | null
  readonly loadStatus: LoadStatus
  readonly loadError: ReadableError | null

  readonly resume: Resume | null
  readonly materialized: MaterializedDocument | null
  readonly layout: LayoutOutput | null
  readonly revisions: readonly Revision[]
  readonly entries: readonly InfoEntry[]
  readonly customModules: readonly CustomModuleDefinition[]
  readonly styles: ResolvedStyles | null
  readonly entryUpdates: ReadonlySet<string>

  readonly committing: boolean
  readonly actionError: ReadableError | null

  readonly selection: StudioSelection
  readonly editorTarget: StudioEditorTarget | null
  readonly activeTab: StudioTab
  readonly zoom: number
  readonly currentPage: number
  readonly fitRequest: number
  readonly pageRequest: PageRequest | null
  readonly sectionRequest: SectionRequest | null

  readonly highlightedSectionIds: readonly ResumeSectionId[]
  readonly agentBusy: boolean
  /** The agent write waiting to be revealed by the mounted studio. */
  readonly revealRequest: ResumeRevealRequest | null

  attach(services: ResumeStudioServices): void
  detach(): void
  loadInitial(): Promise<void>
  reload(id?: ResumeId): Promise<void>
  select(id: ResumeId): Promise<void>
  clearActionError(): void

  createResume(input: { readonly title: string; readonly templateId: TemplateDefinition['id'] }): Promise<boolean>
  duplicateResume(): Promise<boolean>
  renameResume(title: string): Promise<boolean>
  deleteResume(): Promise<boolean>
  setTemplate(templateId: TemplateDefinition['id']): Promise<boolean>
  setAppearance(patch: Partial<AppearanceSettings>): Promise<boolean>
  setPageSetup(patch: Partial<PageSetup>): Promise<boolean>
  setSectionSelection(
    moduleKind: InfoModuleKind,
    customModuleId: CustomModuleDefinition['id'] | null,
    entryIds: readonly InfoEntryId[],
  ): Promise<boolean>
  setSectionOrder(orderedSectionIds: readonly ResumeSectionId[]): Promise<boolean>
  setSectionDisplay(
    sectionId: ResumeSectionId,
    patch: { readonly displayName?: string | null; readonly visible?: boolean; readonly column?: 1 | 2 },
  ): Promise<boolean>
  removeSection(sectionId: ResumeSectionId): Promise<boolean>
  writeSummaryOverride(text: string): Promise<boolean>
  writeEntryOverride(entryId: InfoEntryId, text: string): Promise<boolean>
  deleteOverride(overrideId: ResumeOverrideId): Promise<boolean>
  saveOverrideToLibrary(input: {
    readonly overrideId: ResumeOverrideId
    readonly targetFieldKey: string
    readonly mode: 'replace' | 'append'
  }): Promise<boolean>
  undo(): Promise<boolean>
  redo(): Promise<boolean>
  freeze(): Promise<boolean>
  updateCanvasBlockText(blockId: CanvasBlockId, text: string): Promise<boolean>
  moveFreeBlock(blockId: CanvasBlockId, x: number, y: number): Promise<boolean>

  setZoom(zoom: number): void
  zoomBy(delta: number): void
  requestFitWidth(): void
  setCurrentPage(pageIndex: number): void
  requestPage(pageIndex: number): void
  requestSection(sectionId: ResumeSectionId): void
  setActiveTab(tab: StudioTab): void

  selectBlock(blockId: LayoutBlockId): void
  selectSection(sectionId: ResumeSectionId): void
  clearSelection(): void
  openEditor(blockId: LayoutBlockId): void
  closeEditor(): void

  flashAgentSections(sectionIds: readonly ResumeSectionId[]): void
  clearAgentHighlight(): void
  /** Marks the studio busy while a write tool runs and clears the marker after. */
  setAgentBusy(busy: boolean): void
  /** Queues an agent write for the mounted studio to reveal. */
  requestAgentReveal(input: { readonly resumeId: ResumeId; readonly revisionId: RevisionId | null }): void
  /** Reads and clears the queued reveal. */
  consumeReveal(): ResumeRevealRequest | null
}

/** A single pending highlight timer; a second burst replaces the first. */
let agentHighlightTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Writes are serialized: the use cases guard a stale cursor with
 * `revisionMismatch`, so a slider commit racing a previous commit would be
 * refused. Queueing turns two quick writes into two ordered revisions instead
 * of dropping the second.
 */
let writeQueue: Promise<void> = Promise.resolve()

function clearAgentHighlightTimer(): void {
  if (agentHighlightTimer !== null) {
    clearTimeout(agentHighlightTimer)
    agentHighlightTimer = null
  }
}

function emptyStudio(): Pick<
  ResumeStudioState,
  | 'list'
  | 'listStatus'
  | 'listError'
  | 'selectedId'
  | 'loadStatus'
  | 'loadError'
  | 'resume'
  | 'materialized'
  | 'layout'
  | 'revisions'
  | 'entries'
  | 'customModules'
  | 'styles'
  | 'entryUpdates'
  | 'committing'
  | 'actionError'
  | 'selection'
  | 'editorTarget'
  | 'activeTab'
  | 'currentPage'
  | 'fitRequest'
  | 'pageRequest'
  | 'sectionRequest'
  | 'highlightedSectionIds'
  | 'agentBusy'
  | 'revealRequest'
> {
  return {
    list: [],
    listStatus: 'idle',
    listError: null,
    selectedId: null,
    loadStatus: 'idle',
    loadError: null,
    resume: null,
    materialized: null,
    layout: null,
    revisions: [],
    entries: [],
    customModules: [],
    styles: null,
    entryUpdates: new Set<string>(),
    committing: false,
    actionError: null,
    selection: { kind: 'document' },
    editorTarget: null,
    activeTab: 'composition',
    currentPage: 0,
    fitRequest: 0,
    pageRequest: null,
    sectionRequest: null,
    highlightedSectionIds: [],
    agentBusy: false,
    revealRequest: null,
  }
}

function stylesOf(resume: Resume): ResolvedStyles | null {
  const template = listTemplates().find((candidate) => candidate.id === resume.document.templateId)
  return template === undefined ? null : resolveStyles(template.tokens, resume.document.appearance)
}

/** The blocks the inline editor can start from, keyed by their layout id. */
function blockById(layout: LayoutOutput | null, blockId: LayoutBlockId): LayoutOutput['blocks'][number] | null {
  if (layout === null) return null
  return layout.blocks.find((block) => block.blockId === blockId) ?? null
}

function freeCanvasIdOf(blockId: LayoutBlockId): CanvasBlockId | null {
  return blockId.startsWith('free:') ? (blockId.slice('free:'.length) as CanvasBlockId) : null
}

function sectionIdOfBlock(blockId: LayoutBlockId): ResumeSectionId | null {
  return blockId.startsWith('section:')
    ? (blockId.slice('section:'.length) as ResumeSectionId)
    : null
}

function entryIdOfBlock(blockId: LayoutBlockId): InfoEntryId | null {
  return blockId.startsWith('entry:') ? (blockId.slice('entry:'.length) as InfoEntryId) : null
}

function sectionOfEntry(
  sections: readonly ResumeSection[],
  entryId: InfoEntryId,
): ResumeSection | null {
  return sections.find((section) => section.entryIds.includes(entryId)) ?? null
}

function sortedList(resumes: readonly Resume[]): readonly Resume[] {
  return [...resumes].sort((left, right) =>
    left.updatedAt === right.updatedAt
      ? left.title.localeCompare(right.title)
      : left.updatedAt < right.updatedAt
        ? 1
        : -1,
  )
}

function entryUpdatesOf(
  resume: Resume,
  entries: readonly InfoEntry[],
): ReadonlySet<string> {
  const referenced = new Set<string>()
  for (const section of resume.document.sections) {
    for (const entryId of section.entryIds) referenced.add(entryId)
  }
  for (const override of resume.document.overrides) {
    if (override.target.kind === 'entry') referenced.add(override.target.entryId)
  }
  const resumeTime = new Date(resume.updatedAt).getTime()
  const updated = new Set<string>()
  if (Number.isNaN(resumeTime)) return updated
  for (const entry of entries) {
    if (!referenced.has(entry.id)) continue
    if (new Date(entry.updatedAt).getTime() > resumeTime) updated.add(entry.id)
  }
  return updated
}

/** The initial text an entry editor shows: the rendered body, without heading or meta. */
function bodyTextOf(
  block: LayoutOutput['blocks'][number] | null,
  styles: ResolvedStyles | null,
): string {
  if (block === null) return ''
  const bodyLike = block.lines.filter((line) => line.text.trim() !== '')
  if (styles === null) return bodyLike.map((line) => line.text).join('\n')
  const wanted = styles.entryBody
  return bodyLike
    .filter(
      (line) =>
        line.style.fontFamily === wanted.fontFamily &&
        line.style.fontSize === wanted.fontSize &&
        line.style.fontWeight === wanted.fontWeight &&
        line.style.lineHeight === wanted.lineHeight,
    )
    .map((line) => line.text)
    .join('\n')
}

function summaryTextOf(block: LayoutOutput['blocks'][number] | null): string {
  if (block === null) return ''
  return block.lines
    .filter((line) => line.text.trim() !== '')
    .map((line) => line.text)
    .join('\n')
}

/** Everything one refresh reads, so the reload can apply it in one state write. */
interface ResumeView {
  readonly list: readonly Resume[]
  readonly render: ResumeRender
  readonly revisions: readonly Revision[]
  readonly entries: readonly InfoEntry[]
  readonly customModules: readonly CustomModuleDefinition[]
}

/** Keeps a selection only while the block or chapter it named still renders. */
function selectionIfStillRendered(
  selection: StudioSelection,
  render: ResumeRender,
): StudioSelection {
  if (
    selection.kind === 'section' &&
    render.resume.document.sections.every((section) => section.id !== selection.sectionId)
  ) {
    return { kind: 'document' }
  }
  if (
    selection.kind === 'block' &&
    render.layout.blocks.every((block) => block.blockId !== selection.blockId)
  ) {
    return { kind: 'document' }
  }
  return selection
}

/** The state a successful reload applies, derived from the read bundle. */
function loadedResumeState(
  targetId: ResumeId,
  view: ResumeView,
  selection: StudioSelection,
  currentPage: number,
): Partial<ResumeStudioState> {
  return {
    list: sortedList(view.list),
    listStatus: 'ready',
    listError: null,
    selectedId: targetId,
    loadStatus: 'ready',
    loadError: null,
    resume: view.render.resume,
    materialized: view.render.materialized,
    layout: view.render.layout,
    revisions: view.revisions,
    entries: view.entries,
    customModules: view.customModules,
    styles: stylesOf(view.render.resume),
    entryUpdates: entryUpdatesOf(view.render.resume, view.entries),
    selection: selectionIfStillRendered(selection, view.render),
    editorTarget: null,
    currentPage: Math.min(currentPage, Math.max(0, view.render.layout.pages.length - 1)),
  }
}

function summaryOverrideOf(resume: Resume): ResumeOverride | undefined {
  return resume.document.overrides.find((override) => override.target.kind === 'summary')
}

function entryOverrideOf(resume: Resume, entryId: InfoEntryId): ResumeOverride | undefined {
  return resume.document.overrides.find(
    (override) => override.target.kind === 'entry' && override.target.entryId === entryId,
  )
}

function freeTextTarget(
  resume: Resume,
  layoutBlockId: LayoutBlockId,
  blockId: CanvasBlockId,
): StudioEditorTarget | null {
  const canvasBlock = resume.document.canvas.freeBlocks.find((candidate) => candidate.id === blockId)
  if (canvasBlock === undefined || canvasBlock.kind !== 'text') return null
  return {
    kind: 'freeText',
    layoutBlockId,
    blockId,
    text: canvasBlock.text ?? '',
  }
}

function summaryTarget(
  resume: Resume,
  layoutBlockId: LayoutBlockId,
  block: LayoutOutput['blocks'][number] | null,
): StudioEditorTarget {
  return {
    kind: 'summary',
    layoutBlockId,
    text: summaryOverrideOf(resume)?.text ?? summaryTextOf(block),
  }
}

function headerTarget(resume: Resume, layoutBlockId: LayoutBlockId): StudioEditorTarget | null {
  const personal = resume.document.sections.find((section) => section.moduleKind === 'personal')
  const entryId = personal?.entryIds[0]
  if (personal === undefined || entryId === undefined) return null
  // The header's own lines are the name and contact details; an override
  // writes the body paragraph below them, so a fresh editor starts empty.
  return {
    kind: 'entryOverride',
    layoutBlockId,
    entryId,
    sectionId: personal.id,
    text: entryOverrideOf(resume, entryId)?.text ?? '',
  }
}

function entryTarget(
  resume: Resume,
  layoutBlockId: LayoutBlockId,
  block: LayoutOutput['blocks'][number] | null,
  styles: ResolvedStyles | null,
): StudioEditorTarget | null {
  const entryId = entryIdOfBlock(layoutBlockId)
  if (entryId === null) return null
  const section = sectionOfEntry(resume.document.sections, entryId)
  if (section === null) return null
  return {
    kind: 'entryOverride',
    layoutBlockId,
    entryId,
    sectionId: section.id,
    text: entryOverrideOf(resume, entryId)?.text ?? bodyTextOf(block, styles),
  }
}

function targetForBlock(
  state: ResumeStudioState,
  blockId: LayoutBlockId,
): StudioEditorTarget | null {
  const { resume, materialized, layout, styles } = state
  if (resume === null || materialized === null || layout === null) return null
  if (resume.status === 'frozen') return null
  const freeId = freeCanvasIdOf(blockId)
  if (freeId !== null) return freeTextTarget(resume, blockId, freeId)
  const block = blockById(layout, blockId)
  if (blockId === 'summary') return summaryTarget(resume, blockId, block)
  if (blockId === 'header') return headerTarget(resume, blockId)
  return entryTarget(resume, blockId, block, styles)
}

function bindServices(services: ResumeStudioServices): ResumeStudioServices {
  return { resume: services.resume, info: services.info }
}

export const useResumeStore = create<ResumeStudioState>((set, get) => {
  /**
   * Runs one write through the service, guards a frozen document and re-reads
   * the rendered document afterwards. Every action below shares this path, so
   * the canvas and the panels always show the state the revision chain holds.
   * Writes are queued, because the use cases refuse a stale cursor.
   */
  const run = async (work: (resumeId: ResumeId) => Promise<unknown>): Promise<boolean> => {
    const { services, selectedId: resumeId } = get()
    if (services === null || resumeId === null) return false
    const previous = writeQueue
    let release: () => void = () => undefined
    writeQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      const current = get()
      // A write queued for one resume must never land on another: switching
      // resumes while a debounced commit is in flight would otherwise apply
      // the previous document's patch to the newly selected one.
      if (current.services !== services || current.selectedId !== resumeId) return false
      if (current.resume !== null && current.resume.status === 'frozen') {
        set({ actionError: { message: '这份简历已定稿，复制一份草稿后才能继续修改。', blockers: [] } })
        return false
      }
      set({ committing: true, actionError: null })
      try {
        await work(resumeId)
        const selected = get().selectedId
        if (selected !== null) await get().reload(selected)
        return true
      } catch (thrown) {
        set({ actionError: describeError(thrown) })
        return false
      } finally {
        set({ committing: false })
      }
    } finally {
      release()
    }
  }

  /** Reads the resume list only; the state writes are guarded by the epoch. */
  const refreshList = async (
    services: ResumeStudioServices,
    epoch: number,
    silent: boolean,
  ): Promise<void> => {
    if (!silent) set({ listStatus: 'loading', listError: null })
    try {
      const list = await services.resume.listResumes()
      if (get().epoch !== epoch) return
      set({ list: sortedList(list), listStatus: 'ready', listError: null })
    } catch (thrown) {
      if (get().epoch === epoch) {
        set({ listStatus: 'error', listError: describeError(thrown) })
      }
    }
  }

  /** Reads the list, document, revisions and library, then applies them as one state. */
  const loadResumeView = async (
    services: ResumeStudioServices,
    targetId: ResumeId,
    epoch: number,
    silent: boolean,
  ): Promise<void> => {
    if (!silent) {
      set({ listStatus: 'loading', loadStatus: 'loading', listError: null, loadError: null })
    } else {
      set({ listError: null, loadError: null })
    }
    try {
      const [list, render, revisions, library] = await Promise.all([
        services.resume.listResumes(),
        services.resume.renderResume(targetId),
        services.resume.listRevisions(targetId),
        services.info.listEntries(),
      ])
      if (get().epoch !== epoch) return
      const view: ResumeView = {
        list,
        render,
        revisions,
        entries: library.entries,
        customModules: library.customModules,
      }
      set(loadedResumeState(targetId, view, get().selection, get().currentPage))
    } catch (thrown) {
      if (get().epoch !== epoch) return
      set({ loadStatus: 'error', loadError: describeError(thrown), selectedId: targetId })
    }
  }

  return {
    ...emptyStudio(),
    services: null,
    epoch: 0,
    zoom: 1,

    attach(services) {
      clearAgentHighlightTimer()
      // A reveal queued while the dock was closed must survive the mount: it is
      // the request that makes the panel show the write that opened it.
      const pendingReveal = get().revealRequest
      const pendingBusy = get().agentBusy
      set({
        ...emptyStudio(),
        services: bindServices(services),
        epoch: get().epoch + 1,
        zoom: 1,
        revealRequest: pendingReveal,
        agentBusy: pendingBusy,
      })
    },

    detach() {
      clearAgentHighlightTimer()
      set({ ...emptyStudio(), services: null, epoch: get().epoch + 1 })
    },

    clearActionError() {
      set({ actionError: null })
    },

    async loadInitial() {
      const { services } = get()
      if (services === null) return
      const epoch = get().epoch + 1
      set({ epoch, listStatus: 'loading', listError: null })
      try {
        const list = await services.resume.listResumes()
        if (get().epoch !== epoch) return
        const sorted = sortedList(list)
        set({ list: sorted, listStatus: 'ready', listError: null })
        const first = sorted[0]
        if (first === undefined) {
          set({
            selectedId: null,
            loadStatus: 'ready',
            resume: null,
            materialized: null,
            layout: null,
            revisions: [],
          })
          return
        }
        await get().select(first.id)
      } catch (thrown) {
        if (get().epoch === epoch) {
          set({ listStatus: 'error', listError: describeError(thrown) })
        }
      }
    },

    async reload(id) {
      const { services } = get()
      if (services === null) return
      const epoch = get().epoch + 1
      set({ epoch })
      const targetId = id ?? get().selectedId
      const silent = targetId !== null && targetId === get().selectedId && get().resume !== null
      if (targetId === null) {
        await refreshList(services, epoch, silent)
        return
      }
      await loadResumeView(services, targetId, epoch, silent)
    },

    async select(id) {
      if (get().selectedId === id && get().loadStatus === 'ready') return
      set({
        selectedId: id,
        selection: { kind: 'document' },
        editorTarget: null,
        currentPage: 0,
        highlightedSectionIds: [],
        agentBusy: false,
      })
      await get().reload(id)
    },

    async createResume(input) {
      const { services } = get()
      if (services === null) return false
      set({ committing: true, actionError: null })
      try {
        const created = await services.resume.createResume({
          title: input.title,
          templateId: input.templateId,
        })
        await get().reload(created.resumeId)
        return true
      } catch (thrown) {
        set({ actionError: describeError(thrown) })
        return false
      } finally {
        set({ committing: false })
      }
    },

    async duplicateResume() {
      const { services, selectedId } = get()
      if (services === null || selectedId === null) return false
      set({ committing: true, actionError: null })
      try {
        const created = await services.resume.duplicateResume({ sourceResumeId: selectedId })
        await get().reload(created.resumeId)
        return true
      } catch (thrown) {
        set({ actionError: describeError(thrown) })
        return false
      } finally {
        set({ committing: false })
      }
    },

    async renameResume(title) {
      const { services, selectedId } = get()
      if (services === null || selectedId === null) return false
      set({ committing: true, actionError: null })
      try {
        await services.resume.renameResume({ resumeId: selectedId, title })
        await get().reload(selectedId)
        return true
      } catch (thrown) {
        set({ actionError: describeError(thrown) })
        return false
      } finally {
        set({ committing: false })
      }
    },

    async deleteResume() {
      const { services, selectedId } = get()
      if (services === null || selectedId === null) return false
      set({ committing: true, actionError: null })
      try {
        await services.resume.deleteResume(selectedId)
        set({
          ...emptyStudio(),
          services,
          epoch: get().epoch + 1,
          zoom: get().zoom,
          activeTab: get().activeTab,
        })
        await get().reload()
        const next = get().list[0]
        if (next !== undefined) await get().select(next.id)
        return true
      } catch (thrown) {
        set({ actionError: describeError(thrown) })
        return false
      } finally {
        set({ committing: false })
      }
    },

    setTemplate(templateId) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.setTemplate({ resumeId: selectedId, templateId })
      })
    },

    setAppearance(patch) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.setAppearance({ resumeId: selectedId, patch })
      })
    },

    setPageSetup(patch) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.setPageSetup({ resumeId: selectedId, patch })
      })
    },

    setSectionSelection(moduleKind, customModuleId, entryIds) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.setSectionSelection({
          resumeId: selectedId,
          moduleKind,
          customModuleId,
          entryIds,
        })
      })
    },

    setSectionOrder(orderedSectionIds) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.setSectionOrder({ resumeId: selectedId, orderedSectionIds })
      })
    },

    setSectionDisplay(sectionId, patch) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.setSectionDisplay({ resumeId: selectedId, sectionId, ...patch })
      })
    },

    removeSection(sectionId) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.removeSection({ resumeId: selectedId, sectionId })
      })
    },

    writeSummaryOverride(text) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.writeSummaryOverride({ resumeId: selectedId, text })
      })
    },

    writeEntryOverride(entryId, text) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.writeEntryOverride({ resumeId: selectedId, entryId, text })
      })
    },

    deleteOverride(overrideId) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.deleteOverride({ resumeId: selectedId, overrideId })
      })
    },

    saveOverrideToLibrary(input) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.saveOverrideToLibrary({ resumeId: selectedId, ...input })
      })
    },

    undo() {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.undo(selectedId)
      })
    },

    redo() {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.redo(selectedId)
      })
    },

    freeze() {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.freezeResume(selectedId)
      })
    },

    updateCanvasBlockText(blockId, text) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.updateCanvasBlockText({ resumeId: selectedId, blockId, text })
      })
    },

    moveFreeBlock(blockId, x, y) {
      return run(async () => {
        const { services, selectedId } = get()
        if (services === null || selectedId === null) return
        await services.resume.moveCanvasBlock({ resumeId: selectedId, blockId, x, y })
      })
    },

    setZoom(zoom) {
      set({ zoom: clampCanvasZoom(zoom) })
    },

    zoomBy(delta) {
      get().setZoom(get().zoom + delta)
    },

    requestFitWidth() {
      set({ fitRequest: get().fitRequest + 1 })
    },

    setCurrentPage(pageIndex) {
      const pages = get().layout?.pages.length ?? 0
      set({ currentPage: Math.min(Math.max(0, pageIndex), Math.max(0, pages - 1)) })
    },

    requestPage(pageIndex) {
      get().setCurrentPage(pageIndex)
      set({ pageRequest: { pageIndex, nonce: (get().pageRequest?.nonce ?? 0) + 1 } })
    },

    requestSection(sectionId) {
      set({ sectionRequest: { sectionId, nonce: (get().sectionRequest?.nonce ?? 0) + 1 } })
    },

    setActiveTab(tab) {
      set({ activeTab: tab })
    },

    selectBlock(blockId) {
      const sectionId = sectionIdOfBlock(blockId)
      if (sectionId !== null) {
        set({ selection: { kind: 'section', sectionId } })
        return
      }
      set({ selection: { kind: 'block', blockId } })
    },

    selectSection(sectionId) {
      set({ selection: { kind: 'section', sectionId }, activeTab: 'composition' })
    },

    clearSelection() {
      set({ selection: { kind: 'document' } })
    },

    openEditor(blockId) {
      const target = targetForBlock(get(), blockId)
      if (target !== null) set({ editorTarget: target })
    },

    closeEditor() {
      set({ editorTarget: null })
    },

    flashAgentSections(sectionIds) {
      clearAgentHighlightTimer()
      if (sectionIds.length === 0) {
        // Nothing to point at, but the run that asked for the highlight may
        // still be writing: the busy marker belongs to the run lifecycle, not
        // to one reveal, so this branch only clears the highlight.
        set({ highlightedSectionIds: [] })
        return
      }
      set({ highlightedSectionIds: sectionIds, agentBusy: true })
      agentHighlightTimer = setTimeout(() => {
        agentHighlightTimer = null
        set({ highlightedSectionIds: [], agentBusy: false })
      }, 2000)
    },

    clearAgentHighlight() {
      clearAgentHighlightTimer()
      set({ highlightedSectionIds: [], agentBusy: false })
    },

    setAgentBusy(busy) {
      if (get().agentBusy === busy) return
      set({ agentBusy: busy })
    },

    requestAgentReveal(input) {
      set({
        revealRequest: {
          resumeId: input.resumeId,
          revisionId: input.revisionId,
          nonce: (get().revealRequest?.nonce ?? 0) + 1,
        },
      })
    },

    consumeReveal() {
      const request = get().revealRequest
      if (request === null) return null
      set({ revealRequest: null })
      return request
    },
  }
})

function summaryOverrideIn(resume: Resume): ResumeOverride | undefined {
  return resume.document.overrides.find((override) => override.target.kind === 'summary')
}

function entryOverrideIn(resume: Resume, entryId: InfoEntryId): ResumeOverride | undefined {
  return resume.document.overrides.find(
    (override) => override.target.kind === 'entry' && override.target.entryId === entryId,
  )
}

/** An empty submit deletes the rewrite it edits; a missing one is already clean. */
async function saveOverrideText(
  text: string,
  existing: ResumeOverride | undefined,
  write: (text: string) => Promise<boolean>,
): Promise<boolean> {
  if (text.trim() === '') {
    if (existing === undefined) return true
    return useResumeStore.getState().deleteOverride(existing.id)
  }
  return write(text)
}

/** Save the inline editor's value through the path its target names. */
export async function saveEditorText(text: string): Promise<boolean> {
  const { editorTarget, resume } = useResumeStore.getState()
  if (editorTarget === null || resume === null) return false
  switch (editorTarget.kind) {
    case 'freeText':
      if (text.trim() === '') return false
      return useResumeStore.getState().updateCanvasBlockText(editorTarget.blockId, text)
    case 'summary':
      return saveOverrideText(text, summaryOverrideIn(resume), (next) =>
        useResumeStore.getState().writeSummaryOverride(next),
      )
    case 'entryOverride':
      return saveOverrideText(text, entryOverrideIn(resume, editorTarget.entryId), (next) =>
        useResumeStore.getState().writeEntryOverride(editorTarget.entryId, next),
      )
  }
}

/** The override a block or chapter currently renders, if any. */
export function overrideOfTarget(
  resume: Resume | null,
  target: { readonly kind: 'summary' } | { readonly kind: 'entry'; readonly entryId: InfoEntryId },
): ResumeOverride | null {
  if (resume === null) return null
  return (
    resume.document.overrides.find((override) => {
      if (override.target.kind === 'summary') return target.kind === 'summary'
      return target.kind === 'entry' && override.target.entryId === target.entryId
    }) ?? null
  )
}

/** The section a canvas block belongs to, when it belongs to one. */
export function sectionIdForBlock(
  resume: Resume | null,
  blockId: LayoutBlockId,
): ResumeSectionId | null {
  const direct = sectionIdOfBlock(blockId)
  if (direct !== null) return direct
  if (resume === null) return null
  const entryId = entryIdOfBlock(blockId)
  if (entryId === null) return null
  return sectionOfEntry(resume.document.sections, entryId)?.id ?? null
}

/** The canvas block behind a `free:` layout block id. */
export function canvasBlockForLayoutBlock(
  resume: Resume | null,
  blockId: LayoutBlockId,
): CanvasBlock | null {
  const freeId = freeCanvasIdOf(blockId)
  if (freeId === null || resume === null) return null
  return resume.document.canvas.freeBlocks.find((block) => block.id === freeId) ?? null
}

/** Whether a layout block can open the inline editor. */
export function isEditableBlock(
  resume: Resume | null,
  materialized: MaterializedDocument | null,
  blockId: LayoutBlockId,
): boolean {
  if (resume === null || materialized === null || resume.status === 'frozen') return false
  const block = materialized.blocks.find((candidate) => candidate.id === blockId)
  if (block === undefined) return false
  if (blockId === 'header' || blockId === 'summary') return true
  if (block.role === 'entry' && entryIdOfBlock(blockId) !== null) return true
  const canvasBlock = canvasBlockForLayoutBlock(resume, blockId)
  return canvasBlock !== null && canvasBlock.kind === 'text'
}

/** Compose the settings the appearance panel edits, with a draft applied. */
export function appearanceWith(
  resume: Resume,
  draft: Partial<AppearanceSettings>,
): AppearanceSettings {
  return { ...resume.document.appearance, ...draft }
}

/** One template's identity for the gallery. */
export interface TemplateChoice {
  readonly template: TemplateDefinition
  readonly selected: boolean
}

/** Every template with the selected flag resolved for the current document. */
export function templateChoices(resume: Resume | null): readonly TemplateChoice[] {
  const selected = resume?.document.templateId
  return listTemplates().map((template) => ({
    template,
    selected: template.id === selected,
  }))
}
