/**
 * @file exportPdf
 * @description The PDF export use case: it picks the representation the resume
 * status defines, lays it out with the same pure function the canvas uses,
 * renders it through the exporter port and hands the bytes to the file saver.
 *
 * Responsibilities:
 * - A draft exports its live materialized document; a frozen resume exports its
 *   newest snapshot, so a later library edit cannot change a finalized export
 * - Recompute geometry from the stored layout blocks: a snapshot stores blocks,
 *   not coordinates, so the export recomputes the very pages the canvas draws
 * - Report overflows and warnings before and with the bytes; a draft that still
 *   carries missing references draws their placeholders and says so
 * - Compose the suggested file name from the person, target role and company
 * - Resolve the data URLs of canvas image blocks; an unreadable image becomes a
 *   placeholder plus a warning instead of failing the whole export
 *
 * Constraints:
 * - Read-only: no revision, no change record and no mutation of the resume.
 * - The saver owns the dialog and the write; a dismissed dialog is a cancelled
 *   export (`savedPath` null), not an error.
 * - The renderer never re-wraps: `layout()` owns pagination, the renderer draws
 *   the lines it produced.
 */

import type { AttachmentRepository } from '../../domain/conversation/ports/AttachmentRepository'
import type { FileStore } from '../../domain/conversation/ports/FileStore'
import type { AppearanceSettings } from '../../domain/resume/AppearanceSettings'
import type { LayoutBlock } from '../../domain/resume/Layout'
import type { LayoutOutput, OverflowReport } from '../../domain/resume/PageLayout'
import type { PageSetup } from '../../domain/resume/PageSetup'
import type { Resume } from '../../domain/resume/Resume'
import type { MaterializedDocument } from '../../domain/resume/ResumeSnapshot'
import type { ResumeSnapshot } from '../../domain/resume/ResumeSnapshot'
import type { TemplateDefinition } from '../../domain/resume/Template'
import { resolveTemplate } from '../../domain/resume/Template'
import type { PdfFileSaver } from '../../domain/resume/ports/PdfFileSaver'
import type { ResumePdfExporter } from '../../domain/resume/ports/ResumePdfExporter'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { AttachmentId } from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import { layout } from '../layout/layout'
import { HEADER_BLOCK_ID } from '../resume/materializeDocument'
import type { ResumeContentDeps } from '../resume/resumeSource'
import { loadMaterializedResume, loadResume } from '../resume/resumeSource'
import { suggestedPdfFileName } from './suggestedPdfFileName'

/** What an export reports next to its bytes, per spec section 5.15. */
export type PdfExportWarning =
  | 'missing-reference'
  | 'text-overflow'
  | 'draft-exported'
  | 'missing-image'

/** Everything the interface needs before deciding whether to save. */
export interface PdfExportPlan {
  readonly suggestedFileName: string
  readonly pageCount: number
  readonly overflows: readonly OverflowReport[]
  readonly warnings: readonly PdfExportWarning[]
  /** True when the bytes come from the newest frozen snapshot. */
  readonly frozen: boolean
}

export interface PdfExportDeps extends ResumeContentDeps {
  readonly exporter: ResumePdfExporter
  readonly saver: PdfFileSaver
  readonly attachments: AttachmentRepository
  readonly fileStore: FileStore
}

export interface PreparePdfExportInput {
  readonly resumeId: ResumeId
}

export interface ExportPdfInput {
  readonly resumeId: ResumeId
}

export interface ExportPdfOutput extends PdfExportPlan {
  readonly bytes: Uint8Array
  /**
   * Destination the saver wrote, or null when the user dismissed the dialog.
   * A cancellation still rendered the bytes; nothing was written.
   */
  readonly savedPath: string | null
}

/** The export document: the materialized content plus the geometry it produces. */
interface ExportRepresentation {
  readonly materialized: MaterializedDocument
  readonly laidOut: LayoutOutput
  readonly template: TemplateDefinition
  readonly page: PageSetup
  readonly appearance: AppearanceSettings
}

interface PreparedExport extends ExportRepresentation {
  readonly plan: PdfExportPlan
  readonly images: ReadonlyMap<string, string>
}

/**
 * Read-only preparation: materializes, lays out and reports what the export
 * would contain. The interface calls this first so overflows and warnings are
 * shown before the save dialog opens.
 *
 * @throws DomainError `resumeNotFound`, `emptyResume`, `frozenWithoutSnapshot`.
 */
export async function preparePdfExport(
  deps: PdfExportDeps,
  input: PreparePdfExportInput,
): Promise<PdfExportPlan> {
  return (await prepare(deps, input.resumeId)).plan
}

/**
 * Renders the PDF and asks the saver where to write it. The bytes are produced
 * before the dialog opens: a cancelled dialog still returns them, and the save
 * path is null.
 *
 * @throws DomainError `resumeNotFound`, `emptyResume`, `frozenWithoutSnapshot`.
 */
export async function exportPdf(
  deps: PdfExportDeps,
  input: ExportPdfInput,
): Promise<ExportPdfOutput> {
  const prepared = await prepare(deps, input.resumeId)
  const bytes = await deps.exporter.render({
    blocks: prepared.materialized.blocks,
    page: prepared.page,
    laidOut: prepared.laidOut,
    appearance: prepared.appearance,
    template: prepared.template,
    headerName: headerNameOf(prepared.materialized.blocks),
    images: prepared.images,
  })
  const savedPath = await deps.saver.save(bytes, prepared.plan.suggestedFileName)
  return { ...prepared.plan, bytes, savedPath }
}

async function prepare(deps: PdfExportDeps, resumeId: ResumeId): Promise<PreparedExport> {
  const resume = await loadResume(deps.resumes, resumeId)
  const representation =
    resume.status === 'frozen'
      ? frozenRepresentation(deps, resume)
      : await draftRepresentation(deps, resume)
  const images = await loadImages(deps, representation.materialized.blocks)
  const warnings = collectWarnings(resume, representation, images)
  return {
    ...representation,
    images,
    plan: {
      suggestedFileName: suggestedPdfFileName(resume, headerNameOf(representation.materialized.blocks)),
      // The renderer emits a blank page for an empty layout, so the reported page
      // count is the count the file actually carries.
      pageCount: Math.max(1, representation.laidOut.pages.length),
      overflows: representation.laidOut.overflows,
      warnings,
      frozen: resume.status === 'frozen',
    },
  }
}

/** The live document, materialized and laid out exactly as the canvas reads it. */
async function draftRepresentation(
  deps: PdfExportDeps,
  resume: Resume,
): Promise<ExportRepresentation> {
  const loaded = await loadMaterializedResume(deps, resume)
  if (loaded.document.blocks.length === 0) throw emptyResume(resume)
  return {
    materialized: loaded.document,
    laidOut: loaded.layout,
    template: loaded.input.template,
    page: resume.document.pageSetup,
    appearance: resume.document.appearance,
  }
}

/**
 * The newest snapshot. Its blocks were materialized at freeze time, but its
 * geometry is recomputed: the snapshot stores blocks precisely so the pages can
 * be laid out again with the current layout function.
 */
function frozenRepresentation(deps: PdfExportDeps, resume: Resume): ExportRepresentation {
  const snapshot = newestSnapshot(resume)
  if (snapshot === undefined) {
    throw new DomainError('frozenWithoutSnapshot', 'This frozen resume has no snapshot.', {
      entity: 'resume',
      id: resume.id,
      blockers: [],
    })
  }
  const template = resolveTemplate(snapshot.frozenState.templateId)
  const page = snapshot.frozenState.pageSetup
  return {
    materialized: snapshot.materialized,
    laidOut: layout({
      blocks: snapshot.materialized.blocks,
      page,
      measurer: deps.measurer,
      columnRatio: template.tokens.columnRatio,
      columnGutter: template.tokens.columnGutter,
    }),
    template,
    page,
    appearance: snapshot.frozenState.appearance,
  }
}

/**
 * The snapshot with the highest sequence number. The aggregate does not promise
 * an array order, so the newest snapshot is chosen by the number that defines
 * "newest" rather than by position.
 */
function newestSnapshot(resume: Resume): ResumeSnapshot | undefined {
  let newest: ResumeSnapshot | undefined
  for (const snapshot of resume.snapshots) {
    if (newest === undefined || snapshot.seq > newest.seq) newest = snapshot
  }
  return newest
}

function emptyResume(resume: Resume): DomainError {
  return new DomainError('emptyResume', 'The resume has nothing to render.', {
    entity: 'resume',
    id: resume.id,
    blockers: [],
  })
}

/**
 * The warnings a reader needs before trusting the file: unresolved references
 * and overflows are reported rather than hidden, and any export of a live draft
 * says so because the content can still move.
 */
function collectWarnings(
  resume: Resume,
  representation: ExportRepresentation,
  images: ReadonlyMap<string, string>,
): readonly PdfExportWarning[] {
  const warnings: PdfExportWarning[] = []
  if (representation.materialized.missingReferences.length > 0) {
    warnings.push('missing-reference')
  }
  if (representation.laidOut.overflows.length > 0) warnings.push('text-overflow')
  if (
    representation.materialized.warnings.includes('image-missing') ||
    hasMissingImage(representation.materialized.blocks, images)
  ) {
    warnings.push('missing-image')
  }
  if (resume.status === 'draft') warnings.push('draft-exported')
  return warnings
}

function hasMissingImage(
  blocks: readonly LayoutBlock[],
  images: ReadonlyMap<string, string>,
): boolean {
  return blocks.some(
    (block) => block.image !== null && !images.has(block.image.attachmentId),
  )
}

/**
 * Loads every image block's bytes as a data URL. A row that no longer resolves
 * or a file that cannot be read is skipped: the renderer draws the placeholder
 * and `missing-image` reports it, which is more useful than failing the export.
 */
async function loadImages(
  deps: PdfExportDeps,
  blocks: readonly LayoutBlock[],
): Promise<ReadonlyMap<string, string>> {
  const attachmentIds = new Set<AttachmentId>()
  for (const block of blocks) {
    if (block.image !== null) attachmentIds.add(block.image.attachmentId)
  }
  const images = new Map<string, string>()
  await Promise.all(
    [...attachmentIds].map(async (attachmentId) => {
      try {
        const attachment = await deps.attachments.findById(attachmentId)
        if (attachment === null || attachment.kind !== 'image') return
        const bytes = await deps.fileStore.read(attachment.storageName)
        images.set(attachmentId, `data:${attachment.mimeType};base64,${toBase64(bytes)}`)
      } catch {
        // Reported through the missing-image warning; the placeholder keeps the
        // layout and page count the canvas shows.
      }
    }),
  )
  return images
}

/** The name the split header draws on later pages, taken from the header block. */
function headerNameOf(blocks: readonly LayoutBlock[]): string | null {
  const header = blocks.find((block) => block.id === HEADER_BLOCK_ID)
  // A missing personal entry materializes as a placeholder block with the same
  // id but a freeText role; its "【缺失条目】" text is not a person's name.
  if (header === undefined || header.role !== 'entry') return null
  const name = header.paragraphs[0]?.text.trim() ?? ''
  return name === '' ? null : name
}

const BASE64_CHUNK = 0x8000

/**
 * Base64 for the data URL: `btoa` exists in the WebView and in Node, and the
 * byte string is built in chunks because spreading a font- or image-sized array
 * into one `String.fromCharCode` call overflows the argument limit.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK))
  }
  return btoa(binary)
}
