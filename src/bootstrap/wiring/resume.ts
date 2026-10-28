/**
 * @file resume
 * @description Wires the resume document use cases to the store, the library,
 * the cross-context lookups, the measurer, the clock and the identifier source
 * they need. One file per area, so assembling the resume area changes without
 * touching the others.
 *
 * Constraints:
 * - This module only assembles: it constructs nothing and decides no rule.
 * - The service contract is declared in `capabilities.ts`; this file produces it.
 */

import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { AttachmentRepository } from '../../domain/conversation/ports/AttachmentRepository'
import type { JobPostingRepository } from '../../domain/generation/ports/JobPostingRepository'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { TextMeasurer } from '../../domain/resume/ports/TextMeasurer'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { UpdateInfoEntryInput, UpdateInfoEntryOutput } from '../../application/info/updateInfoEntry'
import type {
  ResumeRender,
  ResumeService,
  UpdateCanvasBlockTextInput,
} from '../capabilities'
import type { FindMissingReferencesDeps } from '../../application/resume/findMissingReferences'
import type { ResumeContentDeps, ResumeStoreDeps } from '../../application/resume/resumeSource'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeId } from '../../domain/shared/branded-id'
import { addCanvasBlock } from '../../application/resume/addCanvasBlock'
import { checkLayoutOverflow } from '../../application/resume/checkLayoutOverflow'
import { commitResumeChange } from '../../application/resume/commitResumeChange'
import { createResume } from '../../application/resume/createResume'
import { deleteOverride } from '../../application/resume/deleteOverride'
import { deleteResume } from '../../application/resume/deleteResume'
import { duplicateResume } from '../../application/resume/duplicateResume'
import { findMissingReferences } from '../../application/resume/findMissingReferences'
import { freezeResume } from '../../application/resume/freezeResume'
import { moveCanvasBlock } from '../../application/resume/moveCanvasBlock'
import { readMaterializedDocument } from '../../application/resume/readMaterializedDocument'
import { redoResumeChange } from '../../application/resume/redoResumeChange'
import { removeCanvasBlock } from '../../application/resume/removeCanvasBlock'
import { removeSection } from '../../application/resume/removeSection'
import { renameResume } from '../../application/resume/renameResume'
import { resizeCanvasBlock } from '../../application/resume/resizeCanvasBlock'
import { saveOverrideToLibrary } from '../../application/resume/saveOverrideToLibrary'
import { setAppearance } from '../../application/resume/setAppearance'
import { setPageSetup } from '../../application/resume/setPageSetup'
import { setSectionDisplay } from '../../application/resume/setSectionDisplay'
import { setSectionOrder } from '../../application/resume/setSectionOrder'
import { setSectionSelection } from '../../application/resume/setSectionSelection'
import { setTemplate } from '../../application/resume/setTemplate'
import { undoResumeChange } from '../../application/resume/undoResumeChange'
import { updateResumeTarget } from '../../application/resume/updateResumeTarget'
import { writeEntryOverride } from '../../application/resume/writeEntryOverride'
import { writeSummaryOverride } from '../../application/resume/writeSummaryOverride'
import { loadMaterializedResume, loadResume } from '../../application/resume/resumeSource'
import { DomainError } from '../../domain/shared/DomainError'
import { listTemplates } from '../../domain/resume/Template'

export interface ResumeWiring {
  readonly resumes: ResumeRepository
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly jobPostings: JobPostingRepository
  readonly attachments: AttachmentRepository
  /** The information-library update use case, bound to its own dependencies. */
  readonly updateInfoEntry: (input: UpdateInfoEntryInput) => Promise<UpdateInfoEntryOutput>
  readonly measurer: TextMeasurer
  readonly clock: Clock
  readonly ids: IdGenerator
}

export function createResumeService(wiring: ResumeWiring): ResumeService {
  const store: ResumeStoreDeps = { resumes: wiring.resumes }
  const content: ResumeContentDeps = {
    resumes: wiring.resumes,
    entries: wiring.entries,
    customModules: wiring.customModules,
    measurer: wiring.measurer,
  }
  const referenceDeps: FindMissingReferencesDeps = {
    ...content,
    jobPostings: wiring.jobPostings,
  }
  const creationDeps = {
    ...content,
    ids: wiring.ids,
    clock: wiring.clock,
  }
  const overrideDeps = { ...store, ids: wiring.ids, clock: wiring.clock }
  return {
    listResumes: () => wiring.resumes.listAll(),
    listTemplates,
    createResume: (input) => createResume(creationDeps, input),
    duplicateResume: (input) =>
      duplicateResume({ ...store, ids: wiring.ids, clock: wiring.clock }, input),
    renameResume: (input) => renameResume({ ...store, clock: wiring.clock }, input),
    deleteResume: (resumeId) => deleteResume(store, resumeId),
    updateResumeTarget: (input) =>
      updateResumeTarget({ ...store, clock: wiring.clock }, input),
    undo: (resumeId) => undoResumeChange(store, resumeId),
    redo: (resumeId) => redoResumeChange(store, resumeId),
    setSectionSelection: (input) =>
      setSectionSelection({ ...store, entries: wiring.entries, ids: wiring.ids }, input),
    setSectionOrder: (input) => setSectionOrder(store, input),
    setSectionDisplay: (input) => setSectionDisplay(store, input),
    removeSection: (input) => removeSection(store, input),
    writeSummaryOverride: (input) => writeSummaryOverride(overrideDeps, input),
    writeEntryOverride: (input) => writeEntryOverride(overrideDeps, input),
    deleteOverride: (input) => deleteOverride(store, input),
    saveOverrideToLibrary: (input) =>
      saveOverrideToLibrary(
        {
          ...store,
          entries: wiring.entries,
          customModules: wiring.customModules,
          updateEntry: wiring.updateInfoEntry,
          clock: wiring.clock,
        },
        input,
      ),
    setTemplate: (input) => setTemplate(store, input),
    setAppearance: (input) => setAppearance(store, input),
    setPageSetup: (input) => setPageSetup(store, input),
    addCanvasBlock: (input) =>
      addCanvasBlock(
        {
          ...content,
          attachments: wiring.attachments,
          ids: wiring.ids,
        },
        input,
      ),
    moveCanvasBlock: (input) => moveCanvasBlock(content, input),
    resizeCanvasBlock: (input) => resizeCanvasBlock(store, input),
    removeCanvasBlock: (input) => removeCanvasBlock(store, input),
    materializeDocument: (input) => readMaterializedDocument(content, input),
    renderResume: (resumeId) => renderResume(content, resumeId),
    listRevisions: (resumeId) => wiring.resumes.listRevisions(resumeId),
    updateCanvasBlockText: (input) => updateCanvasBlockText(content, input),
    findMissingReferences: (input) => findMissingReferences(referenceDeps, input),
    checkLayoutOverflow: (input) => checkLayoutOverflow(content, input),
    freezeResume: (resumeId) =>
      freezeResume(
        {
          ...content,
          jobPostings: wiring.jobPostings,
          ids: wiring.ids,
          clock: wiring.clock,
        },
        resumeId,
      ),
  }
}

/**
 * Materializes and lays out one resume for the studio canvas. The canvas is a
 * reader of the materializer output, never a second renderer with its own text
 * rules, so this facade returns both stages together.
 */
async function renderResume(
  content: ResumeContentDeps,
  resumeId: ResumeId,
): Promise<ResumeRender> {
  const resume = await loadResume(content.resumes, resumeId)
  const rendered = await loadMaterializedResume(content, resume)
  return { resume, materialized: rendered.document, layout: rendered.layout }
}

/**
 * The one inline document edit the resume use cases do not expose: changing a
 * free text block's text. It goes through the same commit point as every other
 * write, so it validates and undoes like the rest.
 */
async function updateCanvasBlockText(
  deps: ResumeContentDeps,
  input: UpdateCanvasBlockTextInput,
): Promise<Revision> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const block = resume.document.canvas.freeBlocks.find((candidate) => candidate.id === input.blockId)
  if (block === undefined) {
    throw new DomainError('canvasBlockNotFound', 'The canvas block no longer exists.', {
      entity: 'canvasBlock',
      id: input.blockId,
      blockers: [input.blockId],
    })
  }
  if (block.kind !== 'text') {
    throw new DomainError('invalidFieldValue', 'Only a text block carries editable text.', {
      entity: 'canvasBlock',
      id: input.blockId,
      blockers: ['text'],
    })
  }
  return commitResumeChange(deps, input.resumeId, {
    label: '编辑画布文字',
    origin: 'user',
    runId: null,
    next: (state) => ({
      ...state,
      canvas: {
        freeBlocks: state.canvas.freeBlocks.map((candidate) =>
          candidate.id === block.id ? { ...candidate, text: input.text } : candidate,
        ),
      },
    }),
  })
}

