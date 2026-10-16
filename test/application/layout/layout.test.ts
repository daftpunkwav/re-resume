import { describe, expect, it } from 'vitest'
import { layout } from '../../../src/application/layout/layout'
import { A4_PAGE_SETUP, contentHeight, contentWidth } from '../../../src/domain/resume/PageSetup'
import type { PageSetup } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../src/domain/resume/Layout'
import type { AbsoluteLayout } from '../../../src/domain/resume/Layout'
import { DEFAULT_TEXT_STYLE } from '../../../src/domain/resume/TextStyle'
import type { TextStyle } from '../../../src/domain/resume/TextStyle'
import type { MaterializedBlock, MaterializedContent } from '../../../src/domain/resume/ResumeSnapshot'
import type { TextMeasurer } from '../../../src/domain/resume/ports/TextMeasurer'
import { parseIsoDate } from '../../../src/domain/shared/DateTime'
import type { IsoDate } from '../../../src/domain/shared/DateTime'
import { asAssetId, asBlockId } from '../../../src/domain/shared/branded-id'

const LATIN_WIDTH = 6
const CJK_WIDTH = 11
const CJK_PER_LINE = Math.floor(contentWidth(A4_PAGE_SETUP) / CJK_WIDTH)
const LINE_HEIGHT = DEFAULT_TEXT_STYLE.fontSize * DEFAULT_TEXT_STYLE.lineHeight
const DIVIDER_HEIGHT = 1
const GRAPHIC_PLACEHOLDER_HEIGHT = 72

/**
 * A deterministic width table: the point of the fixture is that layout never
 * depends on a real font, so the numbers here are fixed per script and the
 * style is ignored on purpose.
 */
class FixedWidthTextMeasurer implements TextMeasurer {
  measureLine(text: string, _style: TextStyle): number {
    let width = 0
    for (const char of text) width += isCjk(char) ? CJK_WIDTH : LATIN_WIDTH
    return width
  }

  measureClusters(text: string, _style: TextStyle): readonly number[] {
    return [...text].map((char) => (isCjk(char) ? CJK_WIDTH : LATIN_WIDTH))
  }
}

function isCjk(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60)
  )
}

const measurer = new FixedWidthTextMeasurer()

function isoDate(value: string): IsoDate {
  const parsed = parseIsoDate(value)
  if (parsed === null) throw new Error(`${value} is not a date`)
  return parsed
}

/** Layout reads materialized blocks, which is what freezing produces. */
function materialized(
  id: string,
  content: MaterializedContent,
  blockLayout: AbsoluteLayout | { readonly mode: 'flow'; readonly columnSpan: 1 | 2 } = DEFAULT_FLOW_LAYOUT,
  textStyle: TextStyle | null = null,
): MaterializedBlock {
  return { id: asBlockId(id), content, layout: blockLayout, textStyle, claims: [] }
}

function textBlock(id: string, text: string, textStyle: TextStyle | null = null): MaterializedBlock {
  return materialized(id, { type: 'text', text }, DEFAULT_FLOW_LAYOUT, textStyle)
}

function absoluteLayout(overrides: Partial<AbsoluteLayout> = {}): AbsoluteLayout {
  return {
    mode: 'absolute',
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    zIndex: 0,
    rotation: 0,
    ...overrides,
  }
}

/** A text block of exactly `lines` full-width CJK lines. */
function cjkLines(count: number): string {
  return '甲'.repeat(CJK_PER_LINE * count)
}

function linesPerPage(page: PageSetup): number {
  return Math.floor(contentHeight(page) / LINE_HEIGHT)
}

describe('layout', () => {
  it('stacks flow blocks in order and wraps text to the content width', () => {
    const result = layout({
      blocks: [textBlock('block-1', '甲'.repeat(CJK_PER_LINE * 3))],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.overflows).toHaveLength(0)
    expect(result.pages).toHaveLength(1)
    const block = result.blocks[0]
    expect(block?.pageIndex).toBe(0)
    expect(block?.x).toBe(0)
    expect(block?.y).toBe(0)
    expect(block?.width).toBe(contentWidth(A4_PAGE_SETUP))
    expect(block?.lines).toHaveLength(3)
    expect(block?.height).toBe(3 * LINE_HEIGHT)
    expect(block?.lines[0]?.text).toHaveLength(CJK_PER_LINE)
  })

  it('resolves a null text style to the default one', () => {
    const withoutStyle = layout({
      blocks: [textBlock('block-1', '短文本。')],
      page: A4_PAGE_SETUP,
      measurer,
    })
    const withStyle = layout({
      blocks: [textBlock('block-1', '短文本。', DEFAULT_TEXT_STYLE)],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(withoutStyle.blocks[0]?.textStyle).toEqual(DEFAULT_TEXT_STYLE)
    expect(withStyle.blocks[0]?.textStyle).toEqual(DEFAULT_TEXT_STYLE)
  })

  it('opens a new page when the remaining height is insufficient', () => {
    // Each block takes more than half a page, so the second one cannot follow.
    const chunkLines = Math.floor(linesPerPage(A4_PAGE_SETUP) / 2) + 5
    const result = layout({
      blocks: [
        textBlock('block-1', cjkLines(chunkLines)),
        textBlock('block-2', cjkLines(chunkLines)),
      ],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.overflows).toHaveLength(0)
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]?.blockIds).toEqual([asBlockId('block-1')])
    expect(result.pages[1]?.blockIds).toEqual([asBlockId('block-2')])
    expect(result.blocks[1]?.pageIndex).toBe(1)
    expect(result.blocks[1]?.y).toBe(0)
  })

  it('reports a block that is taller than a page instead of scaling it', () => {
    const result = layout({
      blocks: [textBlock('block-1', cjkLines(linesPerPage(A4_PAGE_SETUP) + 5))],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.overflows).toEqual([
      { blockId: asBlockId('block-1'), reason: 'block-taller-than-page' },
    ])
    expect(result.blocks[0]?.height).toBeGreaterThan(contentHeight(A4_PAGE_SETUP))
    // It still belongs to the first page: advancing here would report its
    // position one page late and leave an empty page ahead of it.
    expect(result.blocks[0]?.pageIndex).toBe(0)
    expect(result.blocks[0]?.y).toBe(0)
    expect(result.pages).toHaveLength(1)
  })

  it('places an absolute block at its coordinates and keeps it out of the flow', () => {
    const result = layout({
      blocks: [
        textBlock('block-1', '首段。'),
        materialized('block-2', { type: 'text', text: '浮层。' }, absoluteLayout({ x: 40, y: 300 })),
      ],
      page: A4_PAGE_SETUP,
      measurer,
    })

    const absolute = result.blocks[1]
    expect(absolute?.x).toBe(40)
    expect(absolute?.y).toBe(300)
    expect(absolute?.width).toBe(200)
    expect(absolute?.height).toBe(40)
    expect(result.overflows).toHaveLength(0)
    expect(result.blocks[0]?.y).toBe(0)
  })

  it('reports an absolute block that leaves the content box', () => {
    const result = layout({
      blocks: [
        materialized('block-1', { type: 'text', text: '在框内。' }, absoluteLayout({ x: 0, y: 0 })),
        materialized('block-2', { type: 'text', text: '越界。' }, absoluteLayout({ x: 400, y: 10 })),
        materialized('block-3', { type: 'text', text: '左侧越界。' }, absoluteLayout({ x: -10, y: 10 })),
      ],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.overflows).toEqual([
      { blockId: asBlockId('block-2'), reason: 'absolute-out-of-bounds' },
      { blockId: asBlockId('block-3'), reason: 'absolute-out-of-bounds' },
    ])
  })

  it('breaks CJK text without opening a line with closing punctuation', () => {
    const text = `${'甲'.repeat(CJK_PER_LINE + 1)}。${'乙'.repeat(40)}`

    const result = layout({ blocks: [textBlock('block-1', text)], page: A4_PAGE_SETUP, measurer })

    const lines = result.blocks[0]?.lines ?? []
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect('，。、；：？！」』）').not.toContain(line.text.charAt(0))
    }
    expect(lines.map((line) => line.text).join('')).toBe(text)
  })

  it('lays a columnSpan of 2 as a single column', () => {
    const result = layout({
      blocks: [
        materialized('block-1', { type: 'text', text: '通栏。' }, {
          mode: 'flow',
          columnSpan: 2,
        }),
      ],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.blocks[0]?.width).toBe(contentWidth(A4_PAGE_SETUP))
  })

  it('renders a profile block as its identity lines', () => {
    const result = layout({
      blocks: [
        materialized('profile-1', {
          type: 'profile',
          displayName: '张三',
          email: 'zhang@example.com',
          phone: null,
          links: [{ label: '', url: 'https://example.com' }],
        }),
      ],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.blocks[0]?.lines.map((line) => line.text)).toEqual([
      '张三',
      'zhang@example.com',
      'https://example.com',
    ])
  })

  it('renders an experience block as heading, period and variant text', () => {
    const result = layout({
      blocks: [
        materialized('block-1', {
          type: 'experience',
          title: '后端工程师',
          organization: '某公司',
          startDate: isoDate('2020-01-01'),
          endDate: null,
          variantContent: '负责服务治理。',
        }),
      ],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.blocks[0]?.lines.map((line) => line.text)).toEqual([
      '后端工程师',
      '某公司',
      '2020-01-01 -',
      '负责服务治理。',
    ])
  })

  it('renders an experience block with both dates', () => {
    const result = layout({
      blocks: [
        materialized('block-1', {
          type: 'experience',
          title: '后端工程师',
          organization: null,
          startDate: isoDate('2020-01-01'),
          endDate: isoDate('2022-03-01'),
          variantContent: '负责服务治理。',
        }),
      ],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.blocks[0]?.lines.map((line) => line.text)).toEqual([
      '后端工程师',
      '2020-01-01 - 2022-03-01',
      '负责服务治理。',
    ])
  })

  it('draws a divider as a rule with no text line', () => {
    const result = layout({
      blocks: [materialized('divider-1', { type: 'divider' })],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.blocks[0]?.height).toBe(DIVIDER_HEIGHT)
    expect(result.blocks[0]?.lines).toHaveLength(0)
  })

  it('reserves a placeholder box for a flow graphic', () => {
    const result = layout({
      blocks: [
        textBlock('block-1', '图前。'),
        materialized('graphic-1', { type: 'graphic', assetId: asAssetId('asset-1') }),
        textBlock('block-3', '图后。'),
      ],
      page: A4_PAGE_SETUP,
      measurer,
    })

    const graphic = result.blocks[1]
    expect(graphic?.height).toBe(GRAPHIC_PLACEHOLDER_HEIGHT)
    expect(graphic?.lines).toHaveLength(0)
    // The placeholder occupies the flow, so what follows moves down by its height.
    expect(result.blocks[2]?.y).toBe(LINE_HEIGHT + GRAPHIC_PLACEHOLDER_HEIGHT)
  })

  it('takes an absolute graphic extent from its own box', () => {
    const result = layout({
      blocks: [
        materialized(
          'graphic-1',
          { type: 'graphic', assetId: asAssetId('asset-1') },
          absoluteLayout({ width: 120, height: 60 }),
        ),
      ],
      page: A4_PAGE_SETUP,
      measurer,
    })

    expect(result.blocks[0]?.height).toBe(60)
    expect(result.blocks[0]?.width).toBe(120)
    expect(result.blocks[0]?.lines).toHaveLength(0)
  })

  it('returns no page for an empty document', () => {
    const result = layout({ blocks: [], page: A4_PAGE_SETUP, measurer })

    expect(result.pages).toHaveLength(0)
    expect(result.blocks).toHaveLength(0)
    expect(result.overflows).toHaveLength(0)
  })
})
