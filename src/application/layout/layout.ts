/**
 * @file layout
 * @description Pagination and line breaking as a pure function: it turns blocks
 * into positioned lines and never touches the DOM. The canvas preview and both
 * exporters draw this result, so their pagination cannot diverge.
 *
 * Responsibilities:
 * - Render each materialized block into the text it draws, and wrap it to the
 *   content width
 * - Stack flow blocks in order and open a new page when the remaining height is
 *   insufficient
 * - Place absolute blocks at their coordinates and report what does not fit
 *
 * Constraints:
 * - Input blocks are materialized (domain/resume/PageLayout.ts): every reference
 *   was already resolved to text, so layout measures text and nothing else. A
 *   draft is materialized before it reaches here.
 * - AbsoluteLayout documents its origin at the page's top-left; this
 *   implementation measures it against the content box, which is the frame the
 *   canvas works in and the frame the bounds check reports against.
 * - PageSetup.columns is 1, so a columnSpan of 2 lays out as 1.
 * - There is no inter-block spacing model in v1. A divider expresses a gap.
 */

import { contentHeight, contentWidth } from '../../domain/resume/PageSetup'
import { isAbsoluteLayout } from '../../domain/resume/Layout'
import type { AbsoluteLayout } from '../../domain/resume/Layout'
import { resolveTextStyle } from '../../domain/resume/TextStyle'
import type { TextStyle } from '../../domain/resume/TextStyle'
import type { MaterializedContent } from '../../domain/resume/ResumeSnapshot'
import type { IsoDate } from '../../domain/shared/DateTime'
import type { ProfileFields } from '../../domain/catalog/Profile'
import type {
  LaidOutBlock,
  LaidOutPage,
  LayoutInput,
  LayoutOutput,
  OverflowReport,
  TextLine,
} from '../../domain/resume/PageLayout'
import type { TextMeasurer } from '../../domain/resume/ports/TextMeasurer'
import type { BlockId } from '../../domain/shared/branded-id'
import { findBreakOpportunities } from './layout-metrics'

/** Section 12 leaves divider weight undefined; a hairline is the smallest
 *  extent a laid-out divider can have. */
const DIVIDER_HEIGHT = 1

/**
 * Section 12 leaves a flow graphic without a size source, so until asset
 * storage is defined it occupies a placeholder band one inch tall. An absolute
 * graphic takes its extent from its own box and needs no placeholder.
 */
const FLOW_GRAPHIC_PLACEHOLDER_HEIGHT = 72

export function layout(input: LayoutInput): LayoutOutput {
  const availableWidth = contentWidth(input.page)
  const availableHeight = contentHeight(input.page)
  const blocks: LaidOutBlock[] = []
  const overflows: OverflowReport[] = []
  let flowPage = 0
  let flowTop = 0
  for (const block of input.blocks) {
    const textStyle = resolveTextStyle(block.textStyle)
    if (isAbsoluteLayout(block.layout)) {
      const box = block.layout
      blocks.push(
        placeAbsolute(
          block.id,
          box,
          wrapIfText(block.content, textStyle, box.width, input.measurer),
          textStyle,
          availableWidth,
          availableHeight,
          overflows,
        ),
      )
      continue
    }
    const lines = wrapIfText(block.content, textStyle, availableWidth, input.measurer)
    const height = flowHeight(block.content, lines, textStyle)
    if (height > availableHeight) {
      overflows.push({ blockId: block.id, reason: 'block-taller-than-page' })
    }
    // An oversized first block stays on page 0. Advancing first would leave an
    // empty page ahead of it and report its position one page too late.
    if (flowTop > 0 && flowTop + height > availableHeight) {
      flowPage += 1
      flowTop = 0
    }
    blocks.push({
      blockId: block.id,
      pageIndex: flowPage,
      x: 0,
      y: flowTop,
      width: availableWidth,
      height,
      textStyle,
      lines,
    })
    flowTop += height
  }
  return { pages: pagesOf(blocks), blocks, overflows }
}

function placeAbsolute(
  blockId: BlockId,
  box: AbsoluteLayout,
  lines: readonly TextLine[],
  textStyle: TextStyle,
  availableWidth: number,
  availableHeight: number,
  overflows: OverflowReport[],
): LaidOutBlock {
  if (leavesContentBox(box, availableWidth, availableHeight)) {
    overflows.push({ blockId, reason: 'absolute-out-of-bounds' })
  }
  return {
    blockId,
    pageIndex: 0,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    textStyle,
    lines,
  }
}

function leavesContentBox(box: AbsoluteLayout, width: number, height: number): boolean {
  return box.x < 0 || box.y < 0 || box.x + box.width > width || box.y + box.height > height
}

/** Block order within a page carries the block ids the renderer draws. */
function pagesOf(blocks: readonly LaidOutBlock[]): readonly LaidOutPage[] {
  const blockIdsByPage = new Map<number, BlockId[]>()
  for (const block of blocks) {
    const existing = blockIdsByPage.get(block.pageIndex)
    if (existing === undefined) blockIdsByPage.set(block.pageIndex, [block.blockId])
    else existing.push(block.blockId)
  }
  return [...blockIdsByPage.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pageIndex, blockIds]) => ({ pageIndex, blockIds }))
}

/**
 * The text a block draws. Null means the block draws no text: a divider is a
 * rule and a graphic is a box, so neither has a line.
 */
function textOf(content: MaterializedContent): string | null {
  if (content.type === 'text') return content.text
  if (content.type === 'profile') return profileText(content)
  if (content.type === 'experience') return experienceText(content)
  return null
}

function profileText(content: ProfileFields): string {
  const links = content.links.map((link) =>
    link.label.trim() === '' ? link.url : `${link.label} ${link.url}`,
  )
  return [content.displayName, content.email ?? '', content.phone ?? '', ...links]
    .filter((line) => line.trim() !== '')
    .join('\n')
}

/**
 * Heading, employer and period first, then the variant text as its own
 * paragraph: the shape a reader scans, and the one the DOCX exporter expands
 * the block into.
 */
function experienceText(
  content: Extract<MaterializedContent, { readonly type: 'experience' }>,
): string {
  return [
    content.title,
    content.organization,
    periodText(content.startDate, content.endDate),
    content.variantContent,
  ]
    .filter((line) => line !== null && line !== '')
    .join('\n')
}

function periodText(startDate: IsoDate | null, endDate: IsoDate | null): string | null {
  if (startDate === null && endDate === null) return null
  if (startDate === null) return `- ${endDate as string}`
  if (endDate === null) return `${startDate} -`
  return `${startDate} - ${endDate}`
}

function wrapIfText(
  content: MaterializedContent,
  textStyle: TextStyle,
  maxWidth: number,
  measurer: TextMeasurer,
): readonly TextLine[] {
  const text = textOf(content)
  return text === null ? [] : wrapText(text, textStyle, maxWidth, measurer)
}

function flowHeight(
  content: MaterializedContent,
  lines: readonly TextLine[],
  textStyle: TextStyle,
): number {
  if (content.type === 'divider') return DIVIDER_HEIGHT
  if (content.type === 'graphic') return FLOW_GRAPHIC_PLACEHOLDER_HEIGHT
  return lines.length * textStyle.fontSize * textStyle.lineHeight
}

function wrapText(
  text: string,
  textStyle: TextStyle,
  maxWidth: number,
  measurer: TextMeasurer,
): readonly TextLine[] {
  const lines: TextLine[] = []
  for (const paragraph of text.split(/\r\n|\r|\n/u)) {
    lines.push(...wrapParagraph(paragraph, textStyle, maxWidth, measurer))
  }
  return lines
}

/**
 * Greedy wrapping: the last break opportunity that still fits ends the line,
 * and the end of the paragraph is always a candidate. Candidates are measured
 * in order and the scan stops at the first one that overflows, because every
 * earlier candidate has already been decided and a later one cannot yield a
 * shorter line. When nothing fits, the run is kept whole and overflows — an
 * unbreakable word is reported by its position, not silently chopped.
 */
function wrapParagraph(
  paragraph: string,
  textStyle: TextStyle,
  maxWidth: number,
  measurer: TextMeasurer,
): readonly TextLine[] {
  const opportunities = findBreakOpportunities(paragraph)
  const lines: TextLine[] = []
  let start = 0
  while (start < paragraph.length) {
    const end = endOfLine(paragraph, opportunities, start, textStyle, maxWidth, measurer)
    lines.push(lineOf(paragraph.slice(start, end).trimEnd(), textStyle, measurer))
    start = end
  }
  // An empty paragraph still occupies a line, so a deliberate blank line in the
  // document keeps its height.
  if (lines.length === 0) lines.push(lineOf('', textStyle, measurer))
  return lines
}

function endOfLine(
  paragraph: string,
  opportunities: readonly number[],
  start: number,
  textStyle: TextStyle,
  maxWidth: number,
  measurer: TextMeasurer,
): number {
  const rest = paragraph.slice(start)
  if (measurer.measureLine(rest.trimEnd(), textStyle) <= maxWidth) return paragraph.length
  let fitting: number | null = null
  let firstUnfitting: number | null = null
  for (const opportunity of opportunities) {
    if (opportunity <= start || firstUnfitting !== null) continue
    const width = measurer.measureLine(
      paragraph.slice(start, opportunity).trimEnd(),
      textStyle,
    )
    if (width <= maxWidth) fitting = opportunity
    else firstUnfitting = opportunity
  }
  return fitting ?? firstUnfitting ?? paragraph.length
}

function lineOf(
  text: string,
  textStyle: TextStyle,
  measurer: TextMeasurer,
): TextLine {
  return { text, x: 0, width: measurer.measureLine(text, textStyle) }
}
