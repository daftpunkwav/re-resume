/**
 * @file Layout
 * @description How a block is placed on the page, and what the block is made of
 * once the template has been flattened into it. Content semantics stop here:
 * after materialization a block is styled paragraphs plus a placement, so the
 * layout engine never has to know whether it is drawing an internship or a
 * summary.
 *
 * Responsibilities:
 * - Declare the placement of a flow block (columns) or an absolute block (box)
 * - Declare the block role the renderers switch on for decorations
 * - Declare the measured-unit paragraph the layout engine wraps
 *
 * Constraints:
 * - No content type from the information library appears here; that mapping is
 *   `materializeDocument`'s job, and keeping it out is what lets the canvas and
 *   the PDF renderer share one layout result.
 * - Pure data: no DOM, no storage, no package.
 */

import type { AttachmentId, LayoutBlockId } from '../shared/branded-id'
import type { TextStyle } from './TextStyle'

/** Flow blocks take their position from the document, absolute ones from a box. */
export type BlockPlacement =
  | {
      readonly mode: 'flow'
      readonly columnSpan: 1 | 2
      readonly column: 'auto' | 1 | 2
    }
  | {
      readonly mode: 'absolute'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly pageIndex: number
    }

/** What the block draws; renderers use it for heading rules and page numbers. */
export type LayoutRole = 'sectionHeader' | 'entry' | 'freeText' | 'divider' | 'image'

/** One paragraph of a block, already styled. */
export interface StyledParagraph {
  readonly text: string
  readonly style: TextStyle
  /** True when the paragraph draws a bullet before its first line. */
  readonly bullet: boolean
  /** Space before the paragraph, in points; part of the block's height. */
  readonly spaceBefore: number
}

export interface LayoutBlock {
  readonly id: LayoutBlockId
  readonly role: LayoutRole
  readonly paragraphs: readonly StyledParagraph[]
  readonly placement: BlockPlacement
  /** A section heading must not be the last line of a column. */
  readonly keepWithNext: boolean
  /** An entry must not be split across columns or pages. */
  readonly keepTogether: boolean
  /** Set for an image block; never together with paragraphs. */
  readonly image: {
    readonly attachmentId: AttachmentId
    readonly width: number
    readonly height: number
  } | null
}
