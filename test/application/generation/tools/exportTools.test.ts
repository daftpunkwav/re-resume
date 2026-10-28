/**
 * @file exportTools.test
 * @description The export tool end to end against the in-memory pack: the
 * registry entry, the schema the model reads, the saved-path result, the
 * cancelled dialog result, the domain refusal and the read-only contract (no
 * revision and no change record, so the export never enters the undo chain).
 */

import { describe, expect, it } from 'vitest'

import { EXPECTED_TOOL_COUNT } from '../../../../src/application/generation/buildToolRegistry'
import { TOOL_LABELS } from '../../../../src/application/generation/toolLabels'
import { asResumeId } from '../../../../src/domain/shared/branded-id'
import { CancellingPdfFileSaver } from '../../../support/pdfDoubles'
import type { RecordingPdfFileSaver } from '../../../support/pdfDoubles'
import {
  createToolBed,
  createToolConversation,
  invokeTool,
  toolContextOf,
} from '../../../support/toolBed'
import type { ToolCallResult } from '../../../support/toolBed'

interface ExportToolValue {
  readonly savedPath: string | null
  readonly cancelled: boolean
  readonly suggestedFileName: string
  readonly pageCount: number
  readonly frozen: boolean
  readonly overflows: number
  readonly warnings: readonly string[]
}

function exportValue(result: ToolCallResult): ExportToolValue {
  expect(result.ok).toBe(true)
  return result.value as ExportToolValue
}

describe('the exportPdf tool', () => {
  it('is the 26th tool, registered as a write with a card label and a strict schema', () => {
    const bed = createToolBed()
    const tool = bed.registry.get('exportPdf')

    expect(EXPECTED_TOOL_COUNT).toBe(26)
    expect(bed.registry.list()).toHaveLength(26)
    expect(tool).toBeDefined()
    expect(tool?.risk).toBe('write')
    expect(bed.registry.labelFor('exportPdf')).toBe(TOOL_LABELS['exportPdf'])
    expect(TOOL_LABELS['exportPdf']).toBeTruthy()

    const schema = bed.registry.schemas().find((entry) => entry.name === 'exportPdf')
    expect(schema?.parametersJsonSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['resumeId'],
    })
  })

  it('exports the seeded resume and returns the path the saver wrote', async () => {
    const bed = createToolBed()
    const conversation = await createToolConversation(bed)
    const resumes = await bed.resumes.listAll()
    const resume = resumes[0]
    expect(resume).toBeDefined()
    if (resume === undefined) return
    const revisionsBefore = await bed.resumes.listRevisions(resume.id)
    const changesBefore = await bed.changes.listRecent(50)

    const result = await invokeTool(
      bed,
      'exportPdf',
      { resumeId: resume.id },
      toolContextOf(bed, conversation),
    )

    const value = exportValue(result)
    expect(value.savedPath).toBe('C:\\exports\\resume.pdf')
    expect(value.cancelled).toBe(false)
    expect(value.pageCount).toBeGreaterThan(0)
    expect(value.warnings).toContain('draft-exported')
    expect(bed.pdfExporter.inputs).toHaveLength(1)
    expect(bed.pdfExporter.inputs[0]?.laidOut.pages.length).toBe(value.pageCount)

    // Read-only: the export records no revision and no change, so a tool card
    // for it has nothing to undo.
    expect(await bed.resumes.listRevisions(resume.id)).toHaveLength(revisionsBefore.length)
    expect(await bed.changes.listRecent(50)).toHaveLength(changesBefore.length)
  })

  it('reports a dismissed dialog as a cancellation, not a failure', async () => {
    const bed = createToolBed({ pdfSaver: new CancellingPdfFileSaver() })
    const conversation = await createToolConversation(bed)
    const resumes = await bed.resumes.listAll()
    const resume = resumes[0]
    if (resume === undefined) return

    const value = exportValue(
      await invokeTool(bed, 'exportPdf', { resumeId: resume.id }, toolContextOf(bed, conversation)),
    )

    expect(value.savedPath).toBeNull()
    expect(value.cancelled).toBe(true)
    expect(value.pageCount).toBeGreaterThan(0)
  })

  it('returns the domain refusal for a resume that does not exist', async () => {
    const bed = createToolBed()
    const conversation = await createToolConversation(bed)

    const result = await invokeTool(
      bed,
      'exportPdf',
      { resumeId: asResumeId('missing-resume') },
      toolContextOf(bed, conversation),
    )

    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({ ok: false })
    expect(String((result.value as { error?: unknown }).error)).toContain('resumeNotFound')
    expect((bed.pdfSaver as RecordingPdfFileSaver).calls).toHaveLength(0)
  })

  it('refuses a call without a resumeId at parse time', async () => {
    const bed = createToolBed()
    const conversation = await createToolConversation(bed)

    const result = await invokeTool(bed, 'exportPdf', {}, toolContextOf(bed, conversation))

    expect(result.ok).toBe(false)
    expect(result.parseError).toContain('resumeId')
  })
})
