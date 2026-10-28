/**
 * @file exportPdf.test
 * @description The export use case against the in-memory resume store: which
 * representation each status exports, the plan the interface shows before saving,
 * the suggested name, image resolution, the warning set and the cancellation
 * contract. The exporter double records exactly what it was handed — the real
 * renderer is covered byte by byte in its own test.
 */

import { describe, expect, it } from 'vitest'

import { exportPdf, preparePdfExport } from '../../../src/application/export/exportPdf'
import type { PdfExportDeps } from '../../../src/application/export/exportPdf'
import { layout } from '../../../src/application/layout/layout'
import {
  layoutMaterializedDocument,
  materializeDocument,
} from '../../../src/application/resume/materializeDocument'
import type { CanvasBlock } from '../../../src/domain/resume/CanvasLayout'
import type { LayoutBlock } from '../../../src/domain/resume/Layout'
import type { ResumeSnapshot } from '../../../src/domain/resume/ResumeSnapshot'
import { DEFAULT_FONT_FAMILY } from '../../../src/domain/resume/TextStyle'
import type { TargetJob } from '../../../src/domain/resume/TargetJob'
import { resolveTemplate } from '../../../src/domain/resume/Template'
import {
  asAttachmentId,
  asCanvasBlockId,
  asLayoutBlockId,
  asResumeId,
  asSnapshotId,
} from '../../../src/domain/shared/branded-id'
import { InMemoryFileStore } from '../../../src/infrastructure/preview/InMemoryFileStore'
import {
  expectDomainErrorAsync,
} from '../../support/domainErrors'
import {
  FixedBytesPdfExporter,
  FIXED_PDF_BYTES,
  RecordingPdfFileSaver,
  CancellingPdfFileSaver,
} from '../../support/pdfDoubles'
import {
  aDocument,
  aResume,
  aSection,
  aTextBlock,
  attachmentStore,
  contentDeps,
  entriesMap,
  FIXTURE_TIME,
  modulesMap,
  TestLibrary,
  TestResumeStore,
} from '../../support/resumeFixtures'
import type { SeededResumeFixture } from '../../support/resumeFixtures'
import { FixedWidthTextMeasurer } from '../../support/resumeFixtures'

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface ExportBed {
  readonly store: TestResumeStore
  readonly deps: PdfExportDeps
  readonly exporter: FixedBytesPdfExporter
  readonly fileStore: InMemoryFileStore
}

function exportBed(fixture: SeededResumeFixture, attachments: () => ReturnType<typeof attachmentStore> = () => attachmentStore()): ExportBed {
  const store = new TestResumeStore(fixture)
  const exporter = new FixedBytesPdfExporter()
  const fileStore = new InMemoryFileStore()
  const deps: PdfExportDeps = {
    ...contentDeps(store, new TestLibrary()),
    exporter,
    saver: new RecordingPdfFileSaver(),
    attachments: attachments(),
    fileStore,
  }
  return { store, deps, exporter, fileStore }
}

function targetJob(title: string | null, company: string | null): TargetJob {
  return { title, company, jobPostingId: null }
}

/** A frozen resume whose newest snapshot materialized the given fixture document. */
function frozenFixture(
  document = aDocument(),
  frozenBlocks?: readonly LayoutBlock[],
): SeededResumeFixture {
  const draft = aResume({ id: 'resume-frozen', document })
  const template = resolveTemplate(document.templateId)
  const materialized =
    frozenBlocks === undefined
      ? materializeDocument({
          resume: draft.resume,
          entries: entriesMap(),
          customModules: modulesMap(),
          template,
          measurer: new FixedWidthTextMeasurer(),
        })
      : { blocks: frozenBlocks, missingReferences: [], warnings: [] }
  const snapshot: ResumeSnapshot = {
    id: asSnapshotId('snapshot-1'),
    resumeId: draft.resume.id,
    seq: 1,
    frozenState: document,
    materialized,
    createdAt: FIXTURE_TIME,
  }
  return aResume({ id: 'resume-frozen', document, status: 'frozen', snapshots: [snapshot] })
}

function imageBlock(id: string, attachmentId: string): CanvasBlock {
  return {
    id: asCanvasBlockId(id),
    kind: 'image',
    pageIndex: 0,
    x: 300,
    y: 620,
    width: 120,
    height: 80,
    zIndex: 0,
    text: null,
    textStyle: null,
    attachmentId: asAttachmentId(attachmentId),
  }
}

function textBlock(id: string, text: string): LayoutBlock {
  return {
    id: asLayoutBlockId(id),
    role: 'entry',
    paragraphs: [
      {
        text,
        style: {
          fontFamily: DEFAULT_FONT_FAMILY,
          fontSize: 11,
          fontWeight: 400,
          lineHeight: 1.5,
        },
        bullet: false,
        spaceBefore: 0,
      },
    ],
    placement: { mode: 'flow', columnSpan: 1, column: 'auto' },
    keepWithNext: false,
    keepTogether: false,
    image: null,
  }
}

describe('exportPdf', () => {
  it('exports a draft from its live document and reports the draft warning', async () => {
    const fixture = aResume({
      id: 'resume-draft',
      title: '测试简历',
      document: aDocument(),
      targetJob: targetJob('后端工程师', '目标公司'),
    })
    const bed = exportBed(fixture)

    const plan = await preparePdfExport(bed.deps, { resumeId: bed.store.resumeId })
    expect(plan.frozen).toBe(false)
    expect(plan.warnings).toContain('draft-exported')
    expect(plan.pageCount).toBeGreaterThan(1)
    expect(plan.overflows).toEqual([])
    expect(plan.suggestedFileName).toBe('林清越-后端工程师-目标公司.pdf')

    const result = await exportPdf(bed.deps, { resumeId: bed.store.resumeId })
    expect(result.bytes).toEqual(FIXED_PDF_BYTES)
    expect(result.savedPath).toBe('C:\\exports\\resume.pdf')
    expect(result.suggestedFileName).toBe(plan.suggestedFileName)
    expect(result.pageCount).toBe(plan.pageCount)
    expect(bed.exporter.inputs).toHaveLength(1)
    expect(bed.exporter.inputs[0]?.images.size).toBe(0)
    const saver = bed.deps.saver as RecordingPdfFileSaver
    expect(saver.calls).toHaveLength(1)
    expect(saver.calls[0]?.suggestedName).toBe(plan.suggestedFileName)
    expect(saver.calls[0]?.bytes).toEqual(FIXED_PDF_BYTES)
  })

  it('does not mutate the resume: no revision and no state change', async () => {
    const bed = exportBed(aResume({ id: 'resume-readonly' }))
    const before = await bed.store.repository.findById(bed.store.resumeId)

    await exportPdf(bed.deps, { resumeId: bed.store.resumeId })

    expect(await bed.store.repository.findById(bed.store.resumeId)).toBe(before)
    expect(await bed.store.repository.listRevisions(bed.store.resumeId)).toHaveLength(1)
  })

  it('exports a frozen resume from its snapshot, not from the live document', async () => {
    const fixture = frozenFixture()
    const bed = exportBed(fixture)
    const snapshot = fixture.resume.snapshots[0]
    expect(snapshot).toBeDefined()
    if (snapshot === undefined) return
    const expectedLayout = layout({
      blocks: snapshot.materialized.blocks,
      page: snapshot.frozenState.pageSetup,
      measurer: new FixedWidthTextMeasurer(),
      columnRatio: resolveTemplate(snapshot.frozenState.templateId).tokens.columnRatio,
      columnGutter: resolveTemplate(snapshot.frozenState.templateId).tokens.columnGutter,
    })

    const result = await exportPdf(bed.deps, { resumeId: bed.store.resumeId })

    expect(result.frozen).toBe(true)
    expect(result.warnings).not.toContain('draft-exported')
    expect(result.pageCount).toBe(expectedLayout.pages.length)
    expect(bed.exporter.inputs[0]?.blocks).toBe(snapshot.materialized.blocks)
    expect(bed.exporter.inputs[0]?.laidOut.pages.length).toBe(expectedLayout.pages.length)
  })

  it('keeps frozen content independent from later library edits', async () => {
    // The snapshot stores materialized blocks: the export must render these even
    // if the library the freeze was built from changes afterwards.
    const frozenBlocks = [textBlock('entry:old', '冻结时的文案')]
    const bed = exportBed(frozenFixture(aDocument(), frozenBlocks))

    await exportPdf(bed.deps, { resumeId: bed.store.resumeId })

    expect(bed.exporter.inputs[0]?.blocks[0]?.paragraphs[0]?.text).toBe('冻结时的文案')
  })

  it('exports the snapshot with the highest sequence number', async () => {
    const base = frozenFixture(aDocument(), [textBlock('entry:newest', '最新快照')])
    const snapshot = base.resume.snapshots[0]
    expect(snapshot).toBeDefined()
    if (snapshot === undefined) return
    const older = {
      ...snapshot,
      id: asSnapshotId('snapshot-older'),
      seq: 1,
      materialized: { ...snapshot.materialized, blocks: [textBlock('entry:old', '旧快照')] },
    }
    const newer = {
      ...snapshot,
      id: asSnapshotId('snapshot-newer'),
      seq: 2,
      materialized: { ...snapshot.materialized, blocks: [textBlock('entry:newest', '最新快照')] },
    }
    const fixture: SeededResumeFixture = {
      ...base,
      resume: { ...base.resume, snapshots: [newer, older] },
    }
    const bed = exportBed(fixture)

    await exportPdf(bed.deps, { resumeId: bed.store.resumeId })

    expect(bed.exporter.inputs[0]?.blocks[0]?.paragraphs[0]?.text).toBe('最新快照')
  })

  it('falls back to the resume title when the personal entry is missing', async () => {
    const document = aDocument({
      sections: [aSection({ moduleKind: 'personal', entryIds: ['missing-person'] })],
    })
    const bed = exportBed(
      aResume({ id: 'resume-missing-person', title: '备用标题', document, targetJob: null }),
    )

    const result = await exportPdf(bed.deps, { resumeId: bed.store.resumeId })

    // The placeholder block is not a person's name, so the title names the file.
    expect(result.suggestedFileName).toBe('备用标题.pdf')
    expect(result.warnings).toContain('missing-reference')
  })

  it('draws a data URL for a resolvable image and warns when it is missing', async () => {
    const document = aDocument({ freeBlocks: [imageBlock('free-image', 'att-image-1')] })
    const withImage = exportBed(aResume({ id: 'resume-image', document }), () =>
      attachmentStore(['att-image-1']),
    )
    await withImage.fileStore.write('att-image-1.png', IMAGE_BYTES)

    const result = await exportPdf(withImage.deps, { resumeId: withImage.store.resumeId })

    expect(result.warnings).not.toContain('missing-image')
    const dataUrl = withImage.exporter.inputs[0]?.images.get('att-image-1')
    expect(dataUrl).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...IMAGE_BYTES))}`)

    const withoutRow = exportBed(aResume({ id: 'resume-image-missing', document }))
    const missing = await exportPdf(withoutRow.deps, { resumeId: withoutRow.store.resumeId })
    expect(missing.warnings).toContain('missing-image')
    expect(withoutRow.exporter.inputs[0]?.images.size).toBe(0)
    expect(withoutRow.exporter.inputs[0]?.blocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ image: expect.anything() })]),
    )
  })

  it('reports an out-of-content-box block as a text-overflow warning', async () => {
    const document = aDocument({
      freeBlocks: [
        {
          id: asCanvasBlockId('free-overflow'),
          kind: 'text',
          pageIndex: 0,
          x: 480,
          y: 60,
          width: 100,
          height: 24,
          zIndex: 0,
          text: '越界文字',
          textStyle: null,
          attachmentId: null,
        },
      ],
    })
    const bed = exportBed(aResume({ id: 'resume-overflow', document }))

    const result = await exportPdf(bed.deps, { resumeId: bed.store.resumeId })

    expect(result.warnings).toContain('text-overflow')
    expect(result.overflows).toEqual([
      expect.objectContaining({ reason: 'absolute-out-of-bounds' }),
    ])
  })

  it('returns the rendered bytes and no path when the dialog is cancelled', async () => {
    const store = new TestResumeStore(aResume({ id: 'resume-cancel' }))
    const exporter = new FixedBytesPdfExporter()
    const deps: PdfExportDeps = {
      ...contentDeps(store, new TestLibrary()),
      exporter,
      saver: new CancellingPdfFileSaver(),
      attachments: attachmentStore(),
      fileStore: new InMemoryFileStore(),
    }

    const result = await exportPdf(deps, { resumeId: store.resumeId })

    expect(result.savedPath).toBeNull()
    expect(result.bytes).toEqual(FIXED_PDF_BYTES)
  })

  it('reports one page for a layout whose blocks all miss the page', async () => {
    // Free blocks alone produce no flow page, so the layout places nothing and
    // reports the block off-page; the file the renderer emits still has one
    // (blank) page, and the plan reports that count rather than zero.
    const document = aDocument({ sections: [], freeBlocks: [aTextBlock('free-only')] })
    const bed = exportBed(aResume({ id: 'resume-blocks-only', document }))

    const result = await exportPdf(bed.deps, { resumeId: bed.store.resumeId })

    expect(result.pageCount).toBe(1)
    expect(result.warnings).toContain('text-overflow')
    expect(result.overflows).toEqual([
      expect.objectContaining({ reason: 'free-block-off-page' }),
    ])
  })

  it('refuses a missing resume, an empty document and a frozen resume without snapshot', async () => {
    const store = new TestResumeStore(aResume({ id: 'resume-refusals' }))
    const depsFor = (): PdfExportDeps => ({
      ...contentDeps(store, new TestLibrary()),
      exporter: new FixedBytesPdfExporter(),
      saver: new RecordingPdfFileSaver(),
      attachments: attachmentStore(),
      fileStore: new InMemoryFileStore(),
    })

    await expectDomainErrorAsync(
      exportPdf(depsFor(), { resumeId: asResumeId('missing') }),
      'resumeNotFound',
    )

    const emptyStore = new TestResumeStore(
      aResume({ id: 'resume-empty', document: aDocument({ sections: [] }) }),
    )
    const emptyDeps: PdfExportDeps = {
      ...contentDeps(emptyStore, new TestLibrary()),
      exporter: new FixedBytesPdfExporter(),
      saver: new RecordingPdfFileSaver(),
      attachments: attachmentStore(),
      fileStore: new InMemoryFileStore(),
    }
    await expectDomainErrorAsync(
      exportPdf(emptyDeps, { resumeId: emptyStore.resumeId }),
      'emptyResume',
    )

    const frozenWithoutSnapshot = new TestResumeStore(
      aResume({ id: 'resume-frozen-empty', status: 'frozen', snapshots: [] }),
    )
    const frozenDeps: PdfExportDeps = {
      ...contentDeps(frozenWithoutSnapshot, new TestLibrary()),
      exporter: new FixedBytesPdfExporter(),
      saver: new RecordingPdfFileSaver(),
      attachments: attachmentStore(),
      fileStore: new InMemoryFileStore(),
    }
    await expectDomainErrorAsync(
      exportPdf(frozenDeps, { resumeId: frozenWithoutSnapshot.resumeId }),
      'frozenWithoutSnapshot',
    )
  })

  it('lays the draft out with the same function the canvas reads', async () => {
    const document = aDocument()
    const bed = exportBed(aResume({ id: 'resume-layout', document }))
    const input = {
      resume: bed.store.resume,
      entries: entriesMap(),
      customModules: modulesMap(),
      template: resolveTemplate(document.templateId),
      measurer: new FixedWidthTextMeasurer(),
    }
    const expected = layoutMaterializedDocument(input, materializeDocument(input).blocks)

    await exportPdf(bed.deps, { resumeId: bed.store.resumeId })

    expect(bed.exporter.inputs[0]?.laidOut.pages).toEqual(expected.pages)
    expect(bed.exporter.inputs[0]?.laidOut.blocks).toEqual(expected.blocks)
  })
})
