/**
 * @file previewExport.test
 * @description The preview root's export capability: the plan the interface
 * shows before saving is built from the same fixtures the canvas reads, and the
 * stale references of the second sample surface as warnings. Rendering itself
 * is covered against the real renderer in the exporter test; the preview cannot
 * fetch the bundled fonts without a dev server, so this test stops at the plan.
 */

import { describe, expect, it } from 'vitest'

import { createPreviewRoot } from '../../src/bootstrap/previewRoot'
import {
  PREVIEW_CLASSIC_RESUME_ID,
  PREVIEW_TWO_COLUMN_RESUME_ID,
} from '../../src/infrastructure/preview/fixtures.resume'

describe('preview export service', () => {
  it('exposes the export capability on the same contract as the native root', () => {
    const root = createPreviewRoot()

    expect(typeof root.export.preparePdfExport).toBe('function')
    expect(typeof root.export.exportPdf).toBe('function')
  })

  it('plans a draft export of the classic sample with the person-role-company name', async () => {
    const root = createPreviewRoot()

    const plan = await root.export.preparePdfExport({ resumeId: PREVIEW_CLASSIC_RESUME_ID })

    expect(plan.frozen).toBe(false)
    expect(plan.pageCount).toBeGreaterThan(1)
    expect(plan.warnings).toContain('draft-exported')
    expect(plan.overflows).toEqual([])
    expect(plan.suggestedFileName).toBe('林清越-后端开发工程师-目标公司.pdf')
  })

  it('warns about the stale references of the two-column sample', async () => {
    const root = createPreviewRoot()

    const plan = await root.export.preparePdfExport({ resumeId: PREVIEW_TWO_COLUMN_RESUME_ID })

    expect(plan.warnings).toContain('missing-reference')
    expect(plan.warnings).toContain('draft-exported')
    expect(plan.pageCount).toBeGreaterThan(0)
  })
})
