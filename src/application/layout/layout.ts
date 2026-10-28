/**
 * @file layout
 * @description Pagination, column placement and line breaking as a pure
 * function. It turns styled blocks into positioned lines and never touches the
 * DOM or a template: the canvas and the PDF exporter draw this result, so their
 * pagination cannot diverge.
 *
 * Responsibilities:
 * - Split the content box into one or two columns from the ratio and gutter
 * - Wrap every paragraph (bullets, CJK break rules, hard line breaks)
 * - Place flow blocks in reading order honouring keep-with-next, keep-together
 *   and the placement column
 * - Place absolute blocks at their page box and report what misses the page
 * - Emit pages and overflows, and the draw order: flow first, then absolute in
 *   the z-order materialization applied
 *
 * Constraints:
 * - Input blocks are already materialized: every reference was resolved to text,
 *   so this module measures text and nothing else.
 * - Coordinates are relative to the page's content box; the renderer adds the
 *   margins. Absolute blocks are translated from page coordinates on the way in.
 * - The drawing rule for lines is declared in `domain/resume/PageLayout.ts`: the
 *   first line starts after the first paragraph's spaceBefore and lines are
 *   contiguous. Pagination uses the fuller height that includes every
 *   paragraph's spaceBefore.
 */

import { contentHeight, contentWidth, pageHeight, pageWidth } from '../../domain/resume/PageSetup'
import type { LayoutBlock, StyledParagraph } from '../../domain/resume/Layout'
import type {
  LaidOutBlock,
  LaidOutPage,
  LayoutInput,
  LayoutOutput,
  OverflowReport,
  TextLine,
} from '../../domain/resume/PageLayout'
import type { PageSetup } from '../../domain/resume/PageSetup'
import type { TextStyle } from '../../domain/resume/TextStyle'
import type { LayoutBlockId } from '../../domain/shared/branded-id'
import type { TextMeasurer } from '../../domain/resume/ports/TextMeasurer'
import { findBreakOpportunities } from './layout-metrics'

/** A divider with no text is a rule, the smallest extent a block can have. */
const RULE_HEIGHT = 1

const BULLET_PREFIX = '• '

/** How many columns a page has. */
const SINGLE_COLUMN = 1
const TWO_COLUMNS = 2

/** Column geometry in content-box coordinates. */
interface Geometry {
  readonly contentWidth: number
  readonly contentHeight: number
  readonly columns: 1 | 2
  /** Width of column 1 or 2 at index 1 and 2; index 0 is unused. */
  readonly widths: readonly [number, number, number]
  /** Left offset of column 1 or 2 at index 1 and 2; index 0 is unused. */
  readonly offsets: readonly [number, number, number]
  /** Full content width, for a block spanning both columns. */
  readonly spanWidth: number
}

/** A block's paragraphs measured for one column width. */
interface MeasuredBlock {
  readonly lines: readonly TextLine[]
  /** Height pagination accounts for, including every paragraph spaceBefore. */
  readonly height: number
  /** Height of the first paragraph including its spaceBefore. */
  readonly firstParagraphHeight: number
}

/** How much of each flow column the current page has used. */
type ColumnHeights = { readonly 1: number; readonly 2: number }

export function layout(input: LayoutInput): LayoutOutput {
  const geometry = measureGeometry(input)
  const flowBlocks = input.blocks.filter((block) => block.placement.mode === 'flow')
  const absoluteBlocks = input.blocks.filter((block) => block.placement.mode === 'absolute')

  const placed: LaidOutBlock[] = []
  const overflows: OverflowReport[] = []
  if (flowBlocks.length > 0) {
    placeFlowBlocks(input, geometry, flowBlocks, placed, overflows)
  }
  const flowPageCount = placed.reduce(
    (highest, block) => Math.max(highest, block.pageIndex + 1),
    0,
  )
  placeAbsoluteBlocks(input, absoluteBlocks, flowPageCount, placed, overflows)

  return { pages: pagesOf(placed, input.page), blocks: placed, overflows }
}

/** Column widths and offsets. A one-column page ignores the ratio and gutter. */
function measureGeometry(input: LayoutInput): Geometry {
  const width = contentWidth(input.page)
  const height = contentHeight(input.page)
  if (input.page.columns !== TWO_COLUMNS) {
    return {
      contentWidth: width,
      contentHeight: height,
      columns: SINGLE_COLUMN,
      widths: [0, width, width],
      offsets: [0, 0, 0],
      spanWidth: width,
    }
  }
  const first = Math.round(width * input.columnRatio)
  const second = width - first - input.columnGutter
  return {
    contentWidth: width,
    contentHeight: height,
    columns: TWO_COLUMNS,
    widths: [0, first, second],
    offsets: [0, 0, first + input.columnGutter],
    spanWidth: width,
  }
}

/** Places every flow block, advancing page and column according to the rules. */
function placeFlowBlocks(
  input: LayoutInput,
  geometry: Geometry,
  blocks: readonly LayoutBlock[],
  placed: LaidOutBlock[],
  overflows: OverflowReport[],
): void {
  let page = 0
  let column: 1 | 2 = 1
  let heights: ColumnHeights = { 1: 0, 2: 0 }

  const newPage = (): void => {
    page += 1
    column = 1
    heights = { 1: 0, 2: 0 }
  }

  const nextColumn = (): void => {
    if (geometry.columns === SINGLE_COLUMN) {
      newPage()
      return
    }
    if (column === 1) column = 2
    else newPage()
  }

  const addHeight = (placedColumn: 1 | 2, height: number): void => {
    heights =
      placedColumn === 1
        ? { 1: height, 2: heights[2] }
        : { 1: heights[1], 2: height }
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === undefined) continue
    const placement = block.placement
    if (placement.mode !== 'flow') continue

    if (placement.columnSpan === 2) {
      const measured = measureBlock(block, geometry.spanWidth, input.measurer)
      const start = Math.max(heights[1], heights[2])
      if (start > 0 && start + measured.height > geometry.contentHeight) newPage()
      const y = Math.max(heights[1], heights[2])
      place(block, page, 1, 0, y, geometry.spanWidth, measured, placed)
      if (measured.height > geometry.contentHeight) {
        overflows.push({ blockId: block.id, pageIndex: page, reason: 'block-taller-than-column' })
      }
      // The block consumed the full width: both columns continue below it.
      heights = { 1: y + measured.height, 2: y + measured.height }
      column = 1
      continue
    }

    // An explicit column ends the current column when it targets an earlier one,
    // and jumps forward when it targets a later one (spec section 11.3). Once
    // the block no longer fits and a page break is needed, the same target
    // column is used again: placing a body block in the sidebar column of the
    // next page would be a layout the template never asked for.
    const explicitColumn =
      placement.column === 'auto' || geometry.columns !== TWO_COLUMNS
        ? null
        : placement.column
    if (explicitColumn !== null) {
      if (explicitColumn < column) {
        newPage()
        column = explicitColumn
      } else {
        column = explicitColumn
      }
    }
    if (geometry.columns === SINGLE_COLUMN) column = 1

    const advance = (): void => {
      if (explicitColumn === null) {
        nextColumn()
        return
      }
      newPage()
      column = explicitColumn
    }

    let measured = measureBlock(block, geometry.widths[column], input.measurer)
    let guard = 0
    for (;;) {
      const width = geometry.widths[column]
      if (guard > 0) measured = measureBlock(block, width, input.measurer)
      if (measured.height > geometry.contentHeight) {
        // A block taller than a column is drawn from the top of a fresh column
        // and reported; advancing further would leave empty pages ahead of it.
        while (heights[column] > 0 && guard <= 4) {
          advance()
          guard += 1
        }
        measured = measureBlock(block, geometry.widths[column], input.measurer)
        break
      }
      const required = keepWithNextRequirement(
        block,
        measured.height,
        blocks,
        index,
        width,
        geometry,
        input.measurer,
      )
      const needed = Math.min(required, geometry.contentHeight)
      if (heights[column] === 0 || heights[column] + needed <= geometry.contentHeight) break
      advance()
      guard += 1
      if (guard > 4) break
    }

    const start = heights[column]
    place(block, page, column, geometry.offsets[column], start, geometry.widths[column], measured, placed)
    addHeight(column, start + measured.height)
    if (measured.height > geometry.contentHeight) {
      overflows.push({ blockId: block.id, pageIndex: page, reason: 'block-taller-than-column' })
    }
  }
}

/**
 * The height the current column must have free: the block itself, plus the
 * first paragraph of the next flow block when this one is a section heading. A
 * heading that would be the last thing in a column moves with what follows.
 */
function keepWithNextRequirement(
  block: LayoutBlock,
  ownHeight: number,
  blocks: readonly LayoutBlock[],
  index: number,
  width: number,
  geometry: Geometry,
  measurer: TextMeasurer,
): number {
  if (!block.keepWithNext) return ownHeight
  const next = nextFlowBlock(blocks, index)
  if (next === null) return ownHeight
  const nextPlacement = next.placement
  const nextWidth =
    nextPlacement.mode === 'flow' && nextPlacement.columnSpan === 2
      ? geometry.spanWidth
      : width
  return ownHeight + measureBlock(next, nextWidth, measurer).firstParagraphHeight
}

/** The next block that takes part in the flow; absolute blocks are skipped. */
function nextFlowBlock(blocks: readonly LayoutBlock[], index: number): LayoutBlock | null {
  for (let cursor = index + 1; cursor < blocks.length; cursor += 1) {
    const candidate = blocks[cursor]
    if (candidate !== undefined && candidate.placement.mode === 'flow') return candidate
  }
  return null
}

/** Measures a block for a given column width. */
function measureBlock(block: LayoutBlock, width: number, measurer: TextMeasurer): MeasuredBlock {
  if (block.image !== null) {
    return { lines: [], height: block.image.height, firstParagraphHeight: block.image.height }
  }
  if (block.paragraphs.length === 0) {
    return { lines: [], height: RULE_HEIGHT, firstParagraphHeight: RULE_HEIGHT }
  }
  const lines: TextLine[] = []
  let height = 0
  let firstParagraphHeight = 0
  block.paragraphs.forEach((paragraph, paragraphIndex) => {
    const wrapped = measureParagraph(paragraph, width, measurer)
    lines.push(...wrapped.lines)
    height += wrapped.height + paragraph.spaceBefore
    if (paragraphIndex === 0) firstParagraphHeight = wrapped.height + paragraph.spaceBefore
  })
  return { lines, height, firstParagraphHeight }
}

/** Wraps one paragraph, prefixing a bullet to its first line when marked. */
function measureParagraph(
  paragraph: StyledParagraph,
  width: number,
  measurer: TextMeasurer,
): { readonly lines: readonly TextLine[]; readonly height: number } {
  const segments = paragraph.text.split(/\r\n|\r|\n/u)
  const lines: TextLine[] = []
  segments.forEach((segment, segmentIndex) => {
    const text = segmentIndex === 0 && paragraph.bullet ? `${BULLET_PREFIX}${segment}` : segment
    lines.push(...wrapText(text, paragraph.style, width, measurer))
  })
  if (lines.length === 0) lines.push(lineOf('', paragraph.style, measurer))
  const lineHeight = paragraph.style.fontSize * paragraph.style.lineHeight
  return { lines, height: lines.length * lineHeight }
}

/** Greedy wrapping with UAX #14 opportunities and kinsoku (v1 rules). */
function wrapText(
  text: string,
  style: TextStyle,
  maxWidth: number,
  measurer: TextMeasurer,
): readonly TextLine[] {
  if (text.trim() === '') return [lineOf('', style, measurer)]
  const opportunities = findBreakOpportunities(text)
  const lines: TextLine[] = []
  let start = 0
  while (start < text.length) {
    const end = endOfLine(text, opportunities, start, style, maxWidth, measurer)
    lines.push(lineOf(text.slice(start, end).trimEnd(), style, measurer))
    start = end
  }
  return lines
}

/**
 * The last break opportunity that still fits; when nothing fits, the first
 * candidate that overflows ends the line, and a paragraph with no candidate is
 * kept whole. This is the v1 rule and keeps CJK punctuation off line starts.
 */
function endOfLine(
  text: string,
  opportunities: readonly number[],
  start: number,
  style: TextStyle,
  maxWidth: number,
  measurer: TextMeasurer,
): number {
  const rest = text.slice(start).trimEnd()
  if (measurer.measureLine(rest, style) <= maxWidth) return text.length
  let fitting: number | null = null
  let firstUnfitting: number | null = null
  for (const opportunity of opportunities) {
    if (opportunity <= start || firstUnfitting !== null) continue
    const width = measurer.measureLine(text.slice(start, opportunity).trimEnd(), style)
    if (width <= maxWidth) fitting = opportunity
    else firstUnfitting = opportunity
  }
  return fitting ?? firstUnfitting ?? text.length
}

function lineOf(text: string, style: TextStyle, measurer: TextMeasurer): TextLine {
  return {
    text,
    x: 0,
    width: measurer.measureLine(text, style),
    style,
    runs: measurer.resolveRuns(text, style),
  }
}

/** Places one flow block at an absolute content-box position. */
function place(
  block: LayoutBlock,
  page: number,
  column: 1 | 2,
  x: number,
  y: number,
  width: number,
  measured: MeasuredBlock,
  target: LaidOutBlock[],
): void {
  target.push({
    blockId: block.id,
    pageIndex: page,
    columnIndex: column,
    x,
    y,
    width,
    height: measured.height,
    lines: measured.lines,
    image: block.image,
  })
}

/**
 * Places absolute blocks at their page box. Coordinates are stored from the
 * page's top-left and translated into the content box here; a block outside the
 * content box is still drawn (the user placed it on purpose) and reported. The
 * blocks arrive in z-index order from the materializer, and that order is the
 * draw order.
 */
function placeAbsoluteBlocks(
  input: LayoutInput,
  blocks: readonly LayoutBlock[],
  flowPageCount: number,
  placed: LaidOutBlock[],
  overflows: OverflowReport[],
): void {
  const offsetX = input.page.marginLeft
  const offsetY = input.page.marginTop
  for (const block of blocks) {
    const placement = block.placement
    if (placement.mode !== 'absolute') continue
    if (placement.pageIndex >= flowPageCount) {
      overflows.push({
        blockId: block.id,
        pageIndex: placement.pageIndex,
        reason: 'free-block-off-page',
      })
      continue
    }
    if (block.role === 'image' && block.image === null) {
      overflows.push({ blockId: block.id, pageIndex: placement.pageIndex, reason: 'missing-image' })
    }
    const x = placement.x - offsetX
    const y = placement.y - offsetY
    if (leavesContentBox(x, y, placement.width, placement.height, input.page)) {
      overflows.push({
        blockId: block.id,
        pageIndex: placement.pageIndex,
        reason: 'absolute-out-of-bounds',
      })
    }
    placed.push({
      blockId: block.id,
      pageIndex: placement.pageIndex,
      columnIndex: 1,
      x,
      y,
      width: placement.width,
      height: placement.height,
      lines: [],
      image: block.image,
    })
  }
}

function leavesContentBox(
  x: number,
  y: number,
  width: number,
  height: number,
  page: PageSetup,
): boolean {
  return x < 0 || y < 0 || x + width > contentWidth(page) || y + height > contentHeight(page)
}

/** Groups the placed blocks into pages, in draw order. */
function pagesOf(blocks: readonly LaidOutBlock[], page: PageSetup): readonly LaidOutPage[] {
  const byPage = new Map<number, LayoutBlockId[]>()
  for (const block of blocks) {
    const ids = byPage.get(block.pageIndex)
    if (ids === undefined) byPage.set(block.pageIndex, [block.blockId])
    else ids.push(block.blockId)
  }
  return [...byPage.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pageIndex, blockIds]) => ({
      pageIndex,
      width: pageWidth(page),
      height: pageHeight(page),
      blockIds,
    }))
}
