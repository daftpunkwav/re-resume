/**
 * @file layout.test
 * @description The pure layout engine: line wrapping, single and two-column
 * pagination, keep-with-next and keep-together, spanning and absolute blocks,
 * overflow reporting and the draw order the canvas and the PDF share.
 */

import { describe, expect, it } from 'vitest'

import { layout } from '../../../src/application/layout/layout'
import { contentHeight, contentWidth, pageHeight, pageWidth } from '../../../src/domain/resume/PageSetup'
import type { PageSetup } from '../../../src/domain/resume/PageSetup'
import type { LayoutBlock, StyledParagraph } from '../../../src/domain/resume/Layout'
import type { LayoutInput, LaidOutBlock } from '../../../src/domain/resume/PageLayout'
import type { TextStyle } from '../../../src/domain/resume/TextStyle'
import {
  asAttachmentId,
  asLayoutBlockId,
} from '../../../src/domain/shared/branded-id'
import { FixedWidthTextMeasurer } from '../../support/resumeFixtures'

const measurer = new FixedWidthTextMeasurer()
const LINE_HEIGHT = 11 * 1.5
const CJK = '甲'

const A4: PageSetup = {
  paper: 'A4',
  marginTop: 72,
  marginRight: 72,
  marginBottom: 72,
  marginLeft: 72,
  columns: 1,
  showPageNumber: false,
}

const A4_TWO_COLUMN: PageSetup = { ...A4, columns: 2 }

function aParagraph(text: string, options: { readonly spaceBefore?: number; readonly bullet?: boolean; readonly style?: TextStyle } = {}): StyledParagraph {
  return {
    text,
    style: options.style ?? { fontFamily: 'Test', fontSize: 11, fontWeight: 400, lineHeight: 1.5 },
    bullet: options.bullet ?? false,
    spaceBefore: options.spaceBefore ?? 0,
  }
}

function aBlock(
  id: string,
  paragraphs: readonly StyledParagraph[],
  options: {
    readonly placement?: LayoutBlock['placement']
    readonly keepWithNext?: boolean
    readonly keepTogether?: boolean
    readonly role?: LayoutBlock['role']
    readonly image?: LayoutBlock['image']
  } = {},
): LayoutBlock {
  return {
    id: asLayoutBlockId(id),
    role: options.role ?? 'entry',
    paragraphs,
    placement: options.placement ?? { mode: 'flow', columnSpan: 1, column: 'auto' },
    keepWithNext: options.keepWithNext ?? false,
    keepTogether: options.keepTogether ?? false,
    image: options.image ?? null,
  }
}

function textBlock(
  id: string,
  text: string,
  options: Parameters<typeof aBlock>[2] & { readonly spaceBefore?: number } = {},
): LayoutBlock {
  return aBlock(id, [aParagraph(text, { spaceBefore: options.spaceBefore })], options)
}

function cjkLines(count: number): string {
  const perLine = Math.floor(contentWidth(A4) / 11)
  return CJK.repeat(perLine * count)
}

function input(blocks: readonly LayoutBlock[], page: PageSetup = A4): LayoutInput {
  return { blocks, page, measurer, columnRatio: 0.5, columnGutter: 20 }
}

function blockOf(result: ReturnType<typeof layout>, id: string): LaidOutBlock {
  const block = result.blocks.find((candidate) => candidate.blockId === id)
  if (block === undefined) throw new Error(`laid-out block ${id} missing`)
  return block
}

describe('line wrapping and single-column flow', () => {
  it('wraps text to the content width and stacks blocks in order', () => {
    const result = layout(input([textBlock('one', cjkLines(3)), textBlock('two', '短文本')]))
    const first = blockOf(result, 'one')
    expect(first.lines.map((line) => line.text)).toEqual([
      CJK.repeat(Math.floor(contentWidth(A4) / 11)),
      CJK.repeat(Math.floor(contentWidth(A4) / 11)),
      CJK.repeat(Math.floor(contentWidth(A4) / 11)),
    ])
    expect(first.y).toBe(0)
    expect(blockOf(result, 'two').y).toBe(3 * LINE_HEIGHT)
    expect(result.overflows).toEqual([])
    expect(result.pages).toHaveLength(1)
  })

  it('prefixes a bullet on the first line of a bulleted paragraph', () => {
    const result = layout(
      input([aBlock('bullet', [aParagraph('职责一', { bullet: true })])]),
    )
    expect(blockOf(result, 'bullet').lines[0]?.text).toBe('• 职责一')
  })

  it('counts the paragraph space before in the block height', () => {
    const result = layout(
      input([
        aBlock('spaced', [aParagraph('标题', { spaceBefore: 12 }), aParagraph('正文')]),
      ]),
    )
    const block = blockOf(result, 'spaced')
    expect(block.height).toBe(12 + LINE_HEIGHT * 2)
    expect(block.y).toBe(0)
  })

  it('opens a new page when the remaining height is insufficient', () => {
    const halfPage = Math.floor(contentHeight(A4) / LINE_HEIGHT / 2) + 5
    const result = layout(
      input([textBlock('one', cjkLines(halfPage)), textBlock('two', cjkLines(halfPage))]),
    )
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0]?.blockIds).toEqual([asLayoutBlockId('one')])
    expect(blockOf(result, 'two').pageIndex).toBe(1)
    expect(blockOf(result, 'two').y).toBe(0)
  })

  it('draws a block taller than a column at the top of a page and reports it', () => {
    const lines = Math.ceil(contentHeight(A4) / LINE_HEIGHT) + 5
    const result = layout(input([textBlock('tall', cjkLines(lines))]))
    expect(result.overflows).toEqual([
      { blockId: asLayoutBlockId('tall'), pageIndex: 0, reason: 'block-taller-than-column' },
    ])
    expect(blockOf(result, 'tall').pageIndex).toBe(0)
    expect(blockOf(result, 'tall').y).toBe(0)
  })

  it('returns no page for an empty document', () => {
    const result = layout(input([]))
    expect(result.pages).toEqual([])
    expect(result.blocks).toEqual([])
    expect(result.overflows).toEqual([])
  })
})

describe('two-column flow', () => {
  function twoColumnInput(blocks: readonly LayoutBlock[]): LayoutInput {
    return { blocks, page: A4_TWO_COLUMN, measurer, columnRatio: 0.5, columnGutter: 20 }
  }

  const firstWidth = Math.round(contentWidth(A4_TWO_COLUMN) * 0.5)
  const secondWidth = contentWidth(A4_TWO_COLUMN) - firstWidth - 20

  it('fills the first column, then the second, then a new page', () => {
    const lines = Math.floor(contentHeight(A4_TWO_COLUMN) / LINE_HEIGHT / 2) + 3
    const result = layout(
      twoColumnInput([
        textBlock('one', cjkLines(lines)),
        textBlock('two', cjkLines(lines)),
        textBlock('three', cjkLines(lines)),
      ]),
    )
    expect(blockOf(result, 'one').columnIndex).toBe(1)
    expect(blockOf(result, 'one').x).toBe(0)
    expect(blockOf(result, 'one').width).toBe(firstWidth)
    expect(blockOf(result, 'two').columnIndex).toBe(2)
    expect(blockOf(result, 'two').pageIndex).toBe(0)
    expect(blockOf(result, 'two').x).toBe(firstWidth + 20)
    expect(blockOf(result, 'two').width).toBe(secondWidth)
    expect(blockOf(result, 'three').pageIndex).toBe(1)
    expect(blockOf(result, 'three').columnIndex).toBe(1)
  })

  it('honours an explicit column: later column jumps forward, earlier starts a page', () => {
    const result = layout(
      twoColumnInput([
        textBlock('sidebar', '栏一', {
          placement: { mode: 'flow', columnSpan: 1, column: 1 },
        }),
        textBlock('body', '栏二', {
          placement: { mode: 'flow', columnSpan: 1, column: 2 },
        }),
        textBlock('again', '回到栏一', {
          placement: { mode: 'flow', columnSpan: 1, column: 1 },
        }),
      ]),
    )
    expect(blockOf(result, 'sidebar').columnIndex).toBe(1)
    expect(blockOf(result, 'sidebar').pageIndex).toBe(0)
    expect(blockOf(result, 'body').columnIndex).toBe(2)
    expect(blockOf(result, 'body').pageIndex).toBe(0)
    expect(blockOf(result, 'again').columnIndex).toBe(1)
    expect(blockOf(result, 'again').pageIndex).toBe(1)
  })

  it('places a spanning block across the content width below both columns', () => {
    const result = layout(
      twoColumnInput([
        textBlock('sidebar', '栏一', {
          placement: { mode: 'flow', columnSpan: 1, column: 1 },
        }),
        textBlock('body', '栏二', {
          placement: { mode: 'flow', columnSpan: 1, column: 2 },
        }),
        textBlock('span', '通栏', {
          placement: { mode: 'flow', columnSpan: 2, column: 'auto' },
        }),
      ]),
    )
    const span = blockOf(result, 'span')
    expect(span.width).toBe(contentWidth(A4_TWO_COLUMN))
    expect(span.x).toBe(0)
    expect(span.y).toBe(LINE_HEIGHT)
    expect(span.pageIndex).toBe(0)
  })

  it('moves a spanning block to a new page when it does not fit below the columns', () => {
    const lines = Math.floor(contentHeight(A4_TWO_COLUMN) / LINE_HEIGHT) - 1
    const result = layout(
      twoColumnInput([
        textBlock('sidebar', cjkLines(lines), {
          placement: { mode: 'flow', columnSpan: 1, column: 1 },
        }),
        textBlock('span', '通栏', {
          placement: { mode: 'flow', columnSpan: 2, column: 'auto' },
        }),
      ]),
    )
    expect(blockOf(result, 'span').pageIndex).toBe(1)
    expect(blockOf(result, 'span').y).toBe(0)
  })
})

describe('keep rules', () => {
  it('moves a heading to the next page when the following first paragraph does not fit with it', () => {
    const fill = Math.floor(contentHeight(A4) / LINE_HEIGHT) - 1
    const result = layout(
      input([
        textBlock('fill', cjkLines(fill)),
        aBlock('heading', [aParagraph('章节标题')], { keepWithNext: true, role: 'sectionHeader' }),
        aBlock('entry', [aParagraph(cjkLines(2)), aParagraph('正文')]),
      ]),
    )
    expect(blockOf(result, 'heading').pageIndex).toBe(1)
    expect(blockOf(result, 'entry').pageIndex).toBe(1)
    expect(blockOf(result, 'entry').y).toBe(LINE_HEIGHT)
  })

  it('keeps a keep-together entry whole by moving it to the next page', () => {
    const fill = Math.floor(contentHeight(A4) / LINE_HEIGHT) - 2
    const result = layout(
      input([
        textBlock('fill', cjkLines(fill)),
        aBlock('entry', [aParagraph(cjkLines(4))], { keepTogether: true }),
      ]),
    )
    expect(blockOf(result, 'fill').pageIndex).toBe(0)
    expect(blockOf(result, 'entry').pageIndex).toBe(1)
    expect(blockOf(result, 'entry').lines).toHaveLength(4)
  })
})

describe('absolute blocks', () => {
  it('translates page coordinates into the content box', () => {
    const result = layout(
      input([
        textBlock('flow', '正文'),
        aBlock('absolute', [aParagraph('浮层')], {
          role: 'freeText',
          placement: {
            mode: 'absolute',
            x: 100,
            y: 200,
            width: 150,
            height: 40,
            pageIndex: 0,
          },
        }),
      ]),
    )
    const absolute = blockOf(result, 'absolute')
    expect(absolute.x).toBe(100 - A4.marginLeft)
    expect(absolute.y).toBe(200 - A4.marginTop)
    expect(result.overflows).toEqual([])
    expect(result.blocks[result.blocks.length - 1]?.blockId).toBe(
      asLayoutBlockId('absolute'),
    )
  })

  it('draws a block outside the content box and reports it', () => {
    const result = layout(
      input([
        textBlock('flow', '正文'),
        aBlock('outside', [aParagraph('越界')], {
          role: 'freeText',
          placement: { mode: 'absolute', x: 10, y: 10, width: 100, height: 30, pageIndex: 0 },
        }),
      ]),
    )
    expect(result.overflows).toEqual([
      { blockId: asLayoutBlockId('outside'), pageIndex: 0, reason: 'absolute-out-of-bounds' },
    ])
    expect(result.blocks.some((block) => block.blockId === 'outside')).toBe(true)
  })

  it('does not draw a block pinned to a page the document does not have', () => {
    const result = layout(
      input([
        textBlock('flow', '正文'),
        aBlock('future', [aParagraph('下一页')], {
          role: 'freeText',
          placement: { mode: 'absolute', x: 100, y: 100, width: 100, height: 30, pageIndex: 2 },
        }),
      ]),
    )
    expect(result.overflows).toEqual([
      { blockId: asLayoutBlockId('future'), pageIndex: 2, reason: 'free-block-off-page' },
    ])
    expect(result.blocks.some((block) => block.blockId === 'future')).toBe(false)
  })

  it('reports an image block that has no attachment', () => {
    const result = layout(
      input([
        textBlock('flow', '正文'),
        aBlock('image', [], {
          role: 'image',
          image: null,
          placement: { mode: 'absolute', x: 100, y: 100, width: 80, height: 60, pageIndex: 0 },
        }),
      ]),
    )
    expect(result.overflows).toEqual([
      { blockId: asLayoutBlockId('image'), pageIndex: 0, reason: 'missing-image' },
    ])
  })

  it('keeps the input order of absolute blocks, which materialization sorted by z-index', () => {
    const result = layout(
      input([
        textBlock('flow', '正文'),
        aBlock('below', [aParagraph('下')], {
          placement: { mode: 'absolute', x: 100, y: 100, width: 80, height: 30, pageIndex: 0 },
        }),
        aBlock('above', [aParagraph('上')], {
          placement: { mode: 'absolute', x: 100, y: 140, width: 80, height: 30, pageIndex: 0 },
        }),
      ]),
    )
    expect(
      result.blocks.filter((block) => block.pageIndex === 0).map((block) => block.blockId),
    ).toEqual([asLayoutBlockId('flow'), asLayoutBlockId('below'), asLayoutBlockId('above')])
  })

  it('draws an image with no text lines and its placement extent', () => {
    const result = layout(
      input([
        textBlock('flow', '正文'),
        aBlock('image', [], {
          role: 'image',
          image: { attachmentId: asAttachmentId('attachment-1'), width: 80, height: 60 },
          placement: { mode: 'absolute', x: 100, y: 100, width: 80, height: 60, pageIndex: 0 },
        }),
      ]),
    )
    const image = blockOf(result, 'image')
    expect(image.lines).toEqual([])
    expect(image.image).toEqual({
      attachmentId: 'attachment-1',
      width: 80,
      height: 60,
    })
  })
})

describe('pages', () => {
  it('reports the paper extent on every page', () => {
    const result = layout(input([textBlock('one', '正文')]))
    expect(result.pages[0]?.width).toBe(pageWidth(A4))
    expect(result.pages[0]?.height).toBe(pageHeight(A4))
  })

  it('groups the drawn block ids by page in draw order', () => {
    const result = layout(
      input([
        textBlock('one', '正文'),
        aBlock('pinned', [aParagraph('浮层')], {
          placement: { mode: 'absolute', x: 120, y: 120, width: 80, height: 30, pageIndex: 0 },
        }),
      ]),
    )
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]?.blockIds).toEqual([
      asLayoutBlockId('one'),
      asLayoutBlockId('pinned'),
    ])
  })
})
