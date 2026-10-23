/**
 * @file PageLayout
 * @description Layout input and output shapes. They are domain types rather than
 * application types because ToolContext hands them to checkResumeLayout, and
 * the domain cannot import from the application layer.
 */

import type { BlockId } from '../shared/branded-id'
import type { MaterializedBlock } from './ResumeSnapshot'
import type { PageSetup } from './PageSetup'
import type { TextStyle } from './TextStyle'
import type { TextMeasurer, TextRun } from './ports/TextMeasurer'

/**
 * Input blocks are materialized, not live. A live Block that references an
 * experience carries no text — only an id and a variant id — so it cannot be
 * measured, paginated or drawn. Freezing resolves those references once, and
 * the resulting shape is what the canvas, the exporters and the layout check
 * all read.
 */
export interface LayoutInput {
  readonly blocks: readonly MaterializedBlock[]
  readonly page: PageSetup
  readonly measurer: TextMeasurer
}

export interface LaidOutPage {
  readonly pageIndex: number
  readonly blockIds: readonly BlockId[]
}

/** A line as laid out, in block-relative coordinates. */
export interface TextLine {
  readonly text: string
  readonly x: number
  readonly width: number
  /**
   * The stretches of the line one family covers. A renderer draws one text
   * node per run, with the family the run names, so the drawn glyph and the
   * measured advance come from the same face.
   */
  readonly runs: readonly TextRun[]
}

export interface OverflowReport {
  readonly blockId: BlockId
  readonly reason: 'block-taller-than-page' | 'absolute-out-of-bounds'
}

export interface LaidOutBlock {
  readonly blockId: BlockId
  readonly pageIndex: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /**
   * Resolved text style — the block's null already became DEFAULT_TEXT_STYLE
   * here. Exporters read the style from this output, not from the block.
   */
  readonly textStyle: TextStyle
  readonly lines: readonly TextLine[]
}

export interface LayoutOutput {
  readonly pages: readonly LaidOutPage[]
  readonly blocks: readonly LaidOutBlock[]
  /** Blocks that do not fit; each carries a reason for the report. */
  readonly overflows: readonly OverflowReport[]
}
