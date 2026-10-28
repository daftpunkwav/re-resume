/**
 * @file goldenTemplates.test
 * @description The six bundled templates rendered from one fixture resume: the
 * page count, the header height, the first section position and the two-column
 * geometry are pinned, so a token or spacing change that moves content is a
 * deliberate, reviewed diff rather than a silent layout drift.
 *
 * The fixture is the same document for every template; only the template's
 * tokens, defaults and column support differ, which is what makes this a test of
 * the template-to-layout pipeline rather than of one design.
 */

import { describe, expect, it } from 'vitest'

import {
  layoutMaterializedDocument,
  materializeDocument,
} from '../../../src/application/resume/materializeDocument'
import type { MaterializeInput } from '../../../src/application/resume/materializeDocument'
import { listTemplates } from '../../../src/domain/resume/Template'
import { contentWidth } from '../../../src/domain/resume/PageSetup'
import { FixtureTextMeasurer } from '../../../src/infrastructure/measurement/FixtureTextMeasurer'
import {
  aDocument,
  aResume,
  entriesMap,
  modulesMap,
} from '../../support/resumeFixtures'

interface GoldenLayout {
  readonly template: string
  readonly pages: number
  readonly blockCount: number
  readonly headerHeight: number
  readonly firstSectionY: number
}

/** Captured from the fixture document in this file; a change here is a design change. */
const GOLDEN: readonly GoldenLayout[] = [
  {
    template: 'classic-single',
    pages: 3,
    blockCount: 24,
    headerHeight: 93,
    firstSectionY: 93,
  },
  {
    template: 'emphasized-header',
    pages: 3,
    blockCount: 24,
    headerHeight: 102,
    firstSectionY: 102,
  },
  {
    template: 'two-column-sidebar',
    pages: 2,
    blockCount: 24,
    headerHeight: 125.5,
    firstSectionY: 125.5,
  },
  {
    template: 'editorial',
    pages: 3,
    blockCount: 24,
    headerHeight: 101,
    firstSectionY: 101,
  },
  {
    template: 'technical',
    pages: 3,
    blockCount: 24,
    headerHeight: 91.5,
    firstSectionY: 91.5,
  },
  {
    template: 'minimal',
    pages: 3,
    blockCount: 24,
    headerHeight: 85,
    firstSectionY: 85,
  },
]

function inputFor(templateId: string): MaterializeInput {
  const template = listTemplates().find((candidate) => candidate.id === templateId)
  if (template === undefined) throw new Error(`template ${templateId} missing`)
  return {
    resume: aResume({ document: aDocument({ templateId: template.id }) }).resume,
    entries: entriesMap(),
    customModules: modulesMap(),
    template,
    measurer: new FixtureTextMeasurer(),
  }
}

describe('golden template layouts', () => {
  it('pins the page count, header and section position of every template', () => {
    for (const golden of GOLDEN) {
      const input = inputFor(golden.template)
      const materialized = materializeDocument(input)
      const layout = layoutMaterializedDocument(input, materialized.blocks)

      expect(layout.pages.length, `${golden.template} page count`).toBe(golden.pages)
      expect(layout.blocks.length, `${golden.template} block count`).toBe(golden.blockCount)
      expect(layout.overflows, `${golden.template} overflows`).toEqual([])

      const header = layout.blocks.find((block) => block.blockId === 'header')
      expect(header?.pageIndex, `${golden.template} header page`).toBe(0)
      expect(header?.y, `${golden.template} header top`).toBe(0)
      expect(header?.height, `${golden.template} header height`).toBeCloseTo(
        golden.headerHeight,
        6,
      )

      const firstSection = layout.blocks.find((block) =>
        block.blockId.startsWith('section:'),
      )
      expect(firstSection?.pageIndex, `${golden.template} first section page`).toBe(0)
      expect(firstSection?.y, `${golden.template} first section top`).toBeCloseTo(
        golden.firstSectionY,
        6,
      )
    }
  })

  it('lays the sidebar template out in two columns and the rest in one', () => {
    for (const golden of GOLDEN) {
      const input = inputFor(golden.template)
      const materialized = materializeDocument(input)
      const layout = layoutMaterializedDocument(input, materialized.blocks)
      const columns = new Set(layout.blocks.map((block) => block.columnIndex))
      if (golden.template === 'two-column-sidebar') {
        expect([...columns].sort()).toEqual([1, 2])
      } else {
        expect([...columns]).toEqual([1])
      }
    }
  })

  it('uses the template column ratio and gutter for the sidebar geometry', () => {
    const input = inputFor('two-column-sidebar')
    const materialized = materializeDocument(input)
    const layout = layoutMaterializedDocument(input, materialized.blocks)
    const page = input.resume.document.pageSetup
    const width = contentWidth(page)
    const first = Math.round(width * input.template.tokens.columnRatio)
    const second = width - first - input.template.tokens.columnGutter

    const sidebar = layout.blocks.find((block) => block.blockId === 'entry:preview-skill-1')
    const body = layout.blocks.find((block) => block.blockId === 'entry:preview-project-1')
    expect(sidebar?.columnIndex).toBe(1)
    expect(sidebar?.x).toBe(0)
    expect(sidebar?.width).toBe(first)
    expect(body?.columnIndex).toBe(2)
    expect(body?.x).toBe(first + input.template.tokens.columnGutter)
    expect(body?.width).toBe(second)
  })

  it('is deterministic across two materializations of the same state', () => {
    const input = inputFor('classic-single')
    const first = layoutMaterializedDocument(input, materializeDocument(input).blocks)
    const second = layoutMaterializedDocument(input, materializeDocument(input).blocks)
    expect(second.pages).toEqual(first.pages)
    expect(second.blocks).toEqual(first.blocks)
    expect(second.overflows).toEqual(first.overflows)
  })
})
