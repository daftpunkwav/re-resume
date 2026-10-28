/**
 * @file canvasProjection
 * @description Turns one `LayoutOutput` into the flat, page-anchored geometry
 * the canvas draws. The layout engine works in content-box coordinates with
 * columns and pages; the canvas needs page coordinates and per-line boxes, and
 * nothing else. Keeping the conversion in one pure module is what makes the six
 * template layouts testable without a canvas.
 *
 * Responsibilities:
 * - Page list with paper size and draw order
 * - Per-block page coordinates (margins added, column offsets already included)
 * - Per-line boxes for text drawing
 * - Overflow reasons keyed by block id
 *
 * Constraints:
 * - Units are points, exactly as the layout engine and the PDF exporter use.
 *   The screen transform is the only place a zoom is applied.
 * - Pure: no DOM, no canvas, no store.
 */

import type { LayoutRole } from '../../domain/resume/Layout'
import type {
  LayoutOutput,
  LaidOutBlock,
  LaidOutPage,
  OverflowReason,
} from '../../domain/resume/PageLayout'
import type { PageSetup } from '../../domain/resume/PageSetup'
import type { MaterializedDocument } from '../../domain/resume/ResumeSnapshot'
import type { TextStyle } from '../../domain/resume/TextStyle'
import type { LayoutBlockId } from '../../domain/shared/branded-id'

/** One text line, positioned in page points. */
export interface ProjectedLine {
  readonly text: string
  readonly x: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly style: TextStyle
}

/** One drawable block, positioned in page points with the paper's origin. */
export interface ProjectedBlock {
  readonly blockId: LayoutBlockId
  readonly role: LayoutRole
  /** True for a canvas free block; false for a flow block. */
  readonly absolute: boolean
  readonly pageIndex: number
  readonly columnIndex: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly lines: readonly ProjectedLine[]
  readonly image: MaterializedDocument['blocks'][number]['image']
}

/** One page's paper and the blocks that belong to it, in draw order. */
export interface ProjectedPage {
  readonly pageIndex: number
  readonly width: number
  readonly height: number
  readonly blocks: readonly ProjectedBlock[]
}

export interface ProjectedLayout {
  readonly pages: readonly ProjectedPage[]
  readonly blocks: readonly ProjectedBlock[]
  readonly overflows: ReadonlyMap<LayoutBlockId, OverflowReason>
}

interface BlockTraits {
  readonly role: LayoutRole
  readonly absolute: boolean
}

function traitsOf(materialized: MaterializedDocument): ReadonlyMap<LayoutBlockId, BlockTraits> {
  const traits = new Map<LayoutBlockId, BlockTraits>()
  for (const block of materialized.blocks) {
    traits.set(block.id, {
      role: block.role,
      absolute: block.placement.mode === 'absolute',
    })
  }
  return traits
}

/** The y offset of each line within a block, sharing the content height with the layout. */
function projectLines(block: LaidOutBlock): readonly ProjectedLine[] {
  let top = 0
  const lines: ProjectedLine[] = []
  for (const line of block.lines) {
    const height = line.style.fontSize * line.style.lineHeight
    lines.push({
      text: line.text,
      x: line.x,
      top,
      width: line.width,
      height,
      style: line.style,
    })
    top += height
  }
  return lines
}

function projectBlock(
  laidOut: LaidOutBlock,
  traits: ReadonlyMap<LayoutBlockId, BlockTraits>,
  page: PageSetup,
): ProjectedBlock {
  const trait = traits.get(laidOut.blockId)
  return {
    blockId: laidOut.blockId,
    role: trait?.role ?? 'freeText',
    absolute: trait?.absolute ?? false,
    pageIndex: laidOut.pageIndex,
    columnIndex: laidOut.columnIndex,
    x: laidOut.x + page.marginLeft,
    y: laidOut.y + page.marginTop,
    width: laidOut.width,
    height: laidOut.height,
    lines: projectLines(laidOut),
    image: laidOut.image,
  }
}

function pagesWithBlocks(
  pages: readonly LaidOutPage[],
  blocks: readonly ProjectedBlock[],
): readonly ProjectedPage[] {
  const byPage = new Map<number, ProjectedBlock[]>()
  for (const block of blocks) {
    const pageBlocks = byPage.get(block.pageIndex)
    if (pageBlocks === undefined) byPage.set(block.pageIndex, [block])
    else pageBlocks.push(block)
  }
  return pages.map((page) => ({
    pageIndex: page.pageIndex,
    width: page.width,
    height: page.height,
    blocks: byPage.get(page.pageIndex) ?? [],
  }))
}

/** Projects a layout for drawing. */
export function projectResume(
  materialized: MaterializedDocument,
  layout: LayoutOutput,
  page: PageSetup,
): ProjectedLayout {
  const traits = traitsOf(materialized)
  const blocks = layout.blocks.map((block) => projectBlock(block, traits, page))
  const overflows = new Map<LayoutBlockId, OverflowReason>()
  for (const overflow of layout.overflows) overflows.set(overflow.blockId, overflow.reason)
  return { pages: pagesWithBlocks(layout.pages, blocks), blocks, overflows }
}

/** Screen geometry for one page at a zoom; page gaps are CSS pixels and unscaled. */
export interface PageScreenBox {
  readonly pageIndex: number
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface CanvasMetrics {
  /** Width of the widest page at this zoom, in CSS pixels. */
  readonly contentWidth: number
  readonly contentHeight: number
  readonly pageBoxes: readonly PageScreenBox[]
  readonly gap: number
}

/** Stacks the pages vertically with a fixed CSS-pixel gap. */
export function canvasMetrics(
  projected: ProjectedLayout,
  zoom: number,
  gap: number,
): CanvasMetrics {
  const pageBoxes: PageScreenBox[] = []
  let top = 0
  let widest = 0
  for (const page of projected.pages) {
    const width = page.width * zoom
    const height = page.height * zoom
    pageBoxes.push({ pageIndex: page.pageIndex, left: 0, top, width, height })
    top += height + gap
    widest = Math.max(widest, width)
  }
  return {
    contentWidth: widest,
    contentHeight: Math.max(0, top - gap),
    pageBoxes,
    gap,
  }
}

/** The page screen box for one page index. */
export function pageBoxOf(metrics: CanvasMetrics, pageIndex: number): PageScreenBox | null {
  return metrics.pageBoxes.find((box) => box.pageIndex === pageIndex) ?? null
}

/** Block geometry in screen coordinates, for hit areas and the inline editor. */
export function blockScreenRect(
  block: ProjectedBlock,
  pageBox: PageScreenBox,
  zoom: number,
): { readonly left: number; readonly top: number; readonly width: number; readonly height: number } {
  return {
    left: pageBox.left + block.x * zoom,
    top: pageBox.top + block.y * zoom,
    width: block.width * zoom,
    height: block.height * zoom,
  }
}

/** The page nearest the given scroll offset. */
export function pageAtOffset(metrics: CanvasMetrics, offset: number): number {
  if (metrics.pageBoxes.length === 0) return 0
  let nearest = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const box of metrics.pageBoxes) {
    const distance = Math.abs(box.top - offset)
    if (distance < nearestDistance) {
      nearest = box.pageIndex
      nearestDistance = distance
    }
  }
  return nearest
}
