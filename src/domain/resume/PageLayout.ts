/**
 * @file PageLayout
 * @description The input and output of `layout()`: styled blocks go in, and the
 * positioned lines every renderer draws come out. The output carries no
 * document semantics and no template; the canvas and the PDF exporter both draw
 * exactly these coordinates, which is what keeps the two outputs identical.
 *
 * Responsibilities:
 * - Declare the layout input: blocks, page, measurer and the two column values
 *   the materializer takes from the template
 * - Declare the output: positioned blocks, pages, and the overflow report
 *
 * Constraints:
 * - Domain types rather than application types because the canvas renderer and
 *   the PDF exporter both read them (the domain owns the shared vocabulary).
 * - Coordinates are relative to the page's content box: the renderer adds the
 *   page margins, so margins never leak into the layout engine.
 * - Pure data: no DOM, no storage, no package.
 */

import type { LayoutBlockId } from '../shared/branded-id'
import type { LayoutBlock } from './Layout'
import type { PageSetup } from './PageSetup'
import type { TextStyle } from './TextStyle'
import type { TextMeasurer, TextRun } from './ports/TextMeasurer'

export interface LayoutInput {
  readonly blocks: readonly LayoutBlock[]
  readonly page: PageSetup
  readonly measurer: TextMeasurer
  /** Width share of the first column for two-column pages, 0.25..0.5. */
  readonly columnRatio: number
  /** Horizontal gap between the two columns, in points. */
  readonly columnGutter: number
}

/** One line as laid out, positioned inside its block. */
export interface TextLine {
  readonly text: string
  readonly x: number
  readonly width: number
  readonly style: TextStyle
  /** The stretches of the line one family covers; a renderer draws one per run. */
  readonly runs: readonly TextRun[]
}

/**
 * A block placed on a page.
 *
 * Drawing rule: a renderer starts the block's first line at `y` plus the first
 * paragraph's `spaceBefore`, and advances by `style.fontSize × style.lineHeight`
 * per line. That rule is the whole reason `TextLine` carries no `y` of its own,
 * and because the canvas and the PDF exporter follow it alike, the two outputs
 * cannot place a line differently.
 */
export interface LaidOutBlock {
  readonly blockId: LayoutBlockId
  readonly pageIndex: number
  /** 1-based; a block spanning both columns reports column 1. */
  readonly columnIndex: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly lines: readonly TextLine[]
  readonly image: LayoutBlock['image']
}

export type OverflowReason =
  | 'block-taller-than-column'
  | 'absolute-out-of-bounds'
  | 'free-block-off-page'
  | 'missing-image'

export interface OverflowReport {
  readonly blockId: LayoutBlockId
  readonly pageIndex: number
  readonly reason: OverflowReason
}

export interface LaidOutPage {
  readonly pageIndex: number
  readonly width: number
  readonly height: number
  /** Blocks drawn on the page, in draw order. */
  readonly blockIds: readonly LayoutBlockId[]
}

export interface LayoutOutput {
  readonly pages: readonly LaidOutPage[]
  /** Flow blocks in document order, then absolute blocks by z-index. */
  readonly blocks: readonly LaidOutBlock[]
  readonly overflows: readonly OverflowReport[]
}
