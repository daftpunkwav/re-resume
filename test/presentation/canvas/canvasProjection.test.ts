/**
 * @file canvasProjection.test
 * @description The pure projection the canvas draws from. It checks that every
 * bundled template produces pages whose blocks stay inside the paper, that the
 * page boxes stack in order, and that the preview document's absolute free
 * blocks and missing references survive the projection.
 */

import { describe, expect, it } from 'vitest'

import { pageHeight, pageWidth } from '../../../src/domain/resume/PageSetup'
import { listTemplates } from '../../../src/domain/resume/Template'
import {
  canvasMetrics,
  pageAtOffset,
  pageBoxOf,
  projectResume,
} from '../../../src/presentation/canvas/canvasProjection'
import {
  PREVIEW_INFO_CUSTOM_MODULES,
  PREVIEW_INFO_ENTRIES,
} from '../../../src/infrastructure/preview/fixtures.info'
import {
  PREVIEW_RESUMES,
  PREVIEW_TWO_COLUMN_RESUME_ID,
} from '../../../src/infrastructure/preview/fixtures.resume'
import { newResumeStudioRoot, seedResume, studioEntries } from '../../support/resumeStudioRoot'

const GAP = 24

describe('resume canvas projection', () => {
  it.each(listTemplates().map((template) => [template.id, template] as const))(
    'keeps every laid-out block inside the paper for %s',
    async (_id, template) => {
      const root = newResumeStudioRoot()
      const seeded = await seedResume(root, {
        title: `projection-${template.id}`,
        templateId: template.id,
        entries: studioEntries(),
      })
      const rendered = await root.resume.renderResume(seeded.resumeId)
      const projected = projectResume(rendered.materialized, rendered.layout, rendered.resume.document.pageSetup)

      expect(rendered.layout.pages.length).toBeGreaterThan(0)
      expect(projected.pages).toHaveLength(rendered.layout.pages.length)
      expect(projected.blocks.length).toBeGreaterThan(0)

      const paper = {
        width: pageWidth(rendered.resume.document.pageSetup),
        height: pageHeight(rendered.resume.document.pageSetup),
      }
      for (const page of projected.pages) {
        expect(page.width).toBe(paper.width)
        expect(page.height).toBe(paper.height)
      }
      for (const block of projected.blocks) {
        expect(Number.isFinite(block.x + block.y + block.width + block.height)).toBe(true)
        expect(block.pageIndex).toBeGreaterThanOrEqual(0)
        expect(block.pageIndex).toBeLessThan(projected.pages.length)
        expect(block.x).toBeGreaterThanOrEqual(0)
        expect(block.x + block.width).toBeLessThanOrEqual(paper.width + 0.5)
        expect(block.y).toBeGreaterThanOrEqual(0)
      }
      // The one intentional exception is an overflow block, which is reported
      // rather than clipped; every other block must end inside its page.
      for (const block of projected.blocks) {
        if (projected.overflows.has(block.blockId)) continue
        expect(block.y + block.height).toBeLessThanOrEqual(paper.height + 0.5)
      }

      const metrics = canvasMetrics(projected, 0.6, GAP)
      expect(metrics.contentWidth).toBeCloseTo(paper.width * 0.6, 5)
      expect(metrics.pageBoxes).toHaveLength(projected.pages.length)
      for (let index = 1; index < metrics.pageBoxes.length; index += 1) {
        const previous = metrics.pageBoxes[index - 1]
        const current = metrics.pageBoxes[index]
        expect(previous).toBeDefined()
        expect(current).toBeDefined()
        if (previous === undefined || current === undefined) continue
        expect(current.top).toBeCloseTo(previous.top + previous.height + GAP, 5)
        expect(current.left).toBe(0)
      }
      expect(pageBoxOf(metrics, 0)?.top).toBe(0)
      expect(pageAtOffset(metrics, 0)).toBe(0)
      if (metrics.pageBoxes.length > 1) {
        const second = metrics.pageBoxes[1]
        expect(second).toBeDefined()
        if (second !== undefined) expect(pageAtOffset(metrics, second.top)).toBe(1)
      }
    },
  )

  it('projects the preview document with its free blocks and missing entries', async () => {
    const root = newResumeStudioRoot({
      entries: PREVIEW_INFO_ENTRIES,
      customModules: PREVIEW_INFO_CUSTOM_MODULES,
    })
    root.resumes.seed(PREVIEW_RESUMES)
    const rendered = await root.resume.renderResume(PREVIEW_TWO_COLUMN_RESUME_ID)
    const projected = projectResume(rendered.materialized, rendered.layout, rendered.resume.document.pageSetup)

    expect(rendered.layout.pages.length).toBeGreaterThan(0)
    expect(rendered.materialized.missingReferences.length).toBeGreaterThan(0)
    expect(projected.overflows.size).toBe(rendered.layout.overflows.length)

    const freeBlocks = projected.blocks.filter((block) => block.absolute)
    expect(freeBlocks.length).toBeGreaterThan(0)
    expect(freeBlocks.every((block) => block.blockId.startsWith('free:'))).toBe(true)

    // The two-column preview uses the id the canvas keys section highlight by.
    expect(projected.blocks.some((block) => block.blockId.startsWith('section:'))).toBe(true)
    expect(projected.blocks.some((block) => block.blockId.startsWith('entry:'))).toBe(true)
  })
})
