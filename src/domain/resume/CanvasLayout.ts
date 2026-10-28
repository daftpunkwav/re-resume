/**
 * @file CanvasLayout
 * @description Free-positioned canvas blocks: text, rules and images the user
 * places on a page by hand. They are absolute content, so the layout engine only
 * has to place them at their coordinates and report what leaves the page; the
 * document model still validates every box before it is stored.
 *
 * Responsibilities:
 * - Declare the three block kinds and their content rules
 * - Validate a block against the page it is placed on
 * - Validate the identity and layering rules of the whole layout
 *
 * Constraints:
 * - Coordinates are points from the page's top-left corner; no rotation.
 * - The bounds check uses the physical page, not the content box: a user may
 *   place a block into the margin on purpose (the layout reports it).
 * - Pure data: no DOM, no storage, no package.
 */

import type { AttachmentId, CanvasBlockId } from '../shared/branded-id'
import { DomainError } from '../shared/DomainError'
import { countCodePoints } from '../info/codePoints'
import type { PageSetup } from './PageSetup'
import { pageHeight, pageWidth } from './PageSetup'
import type { TextStyle } from './TextStyle'
import { assertTextStyle } from './TextStyle'

export type CanvasBlockKind = 'text' | 'divider' | 'image'

export const CANVAS_BLOCK_MIN_SIZE = 8
export const CANVAS_BLOCK_MAX_TEXT_LENGTH = 4000
export const CANVAS_Z_INDEX_MAX = 999

export interface CanvasBlock {
  readonly id: CanvasBlockId
  readonly kind: CanvasBlockKind
  /** Zero-based page the block is pinned to. */
  readonly pageIndex: number
  /** Box in points, origin at the page's top-left corner. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** Paint order among free blocks: 0..999, larger draws above. */
  readonly zIndex: number
  readonly text: string | null
  readonly textStyle: TextStyle | null
  readonly attachmentId: AttachmentId | null
}

export interface CanvasLayout {
  readonly freeBlocks: readonly CanvasBlock[]
}

function blockError(
  code: 'canvasBlockOutOfBounds' | 'invalidFieldValue' | 'fieldTooLong',
  message: string,
  id: string,
  blockers: readonly string[] = [],
): DomainError {
  return new DomainError(code, message, { entity: 'canvasBlock', id, blockers })
}

function assertFinite(field: string, value: number, id: string): void {
  if (!Number.isFinite(value)) {
    throw blockError(
      'canvasBlockOutOfBounds',
      `The canvas block coordinate "${field}" must be a finite number.`,
      id,
      [field],
    )
  }
}

/**
 * Validates one canvas block's shape, content and box.
 *
 * @throws DomainError `canvasBlockOutOfBounds` for a box outside the page or
 *   smaller than the minimum, `invalidFieldValue` for a content/kind mismatch,
 *   `fieldTooLong` for over-long text.
 */
export function assertCanvasBlock(block: CanvasBlock, page: PageSetup): void {
  if (block.kind !== 'text' && block.kind !== 'divider' && block.kind !== 'image') {
    throw blockError('invalidFieldValue', 'Unknown canvas block kind.', block.id, [block.kind])
  }
  assertPageIndex(block)
  assertZIndex(block)
  assertBox(block, page)
  if (block.kind === 'text') {
    assertTextBlockContent(block)
    return
  }
  assertNonTextBlockContent(block)
}

function assertPageIndex(block: CanvasBlock): void {
  if (!Number.isInteger(block.pageIndex) || block.pageIndex < 0) {
    throw blockError(
      'canvasBlockOutOfBounds',
      'A canvas block page index must be a non-negative integer.',
      block.id,
      [String(block.pageIndex)],
    )
  }
}

function assertZIndex(block: CanvasBlock): void {
  if (!Number.isInteger(block.zIndex) || block.zIndex < 0 || block.zIndex > CANVAS_Z_INDEX_MAX) {
    throw blockError(
      'invalidFieldValue',
      `A canvas block z-index must be an integer from 0 to ${CANVAS_Z_INDEX_MAX.toString()}.`,
      block.id,
      [String(block.zIndex)],
    )
  }
}

/** The box must be finite, at least the minimum size and inside the page. */
function assertBox(block: CanvasBlock, page: PageSetup): void {
  assertFinite('x', block.x, block.id)
  assertFinite('y', block.y, block.id)
  assertFinite('width', block.width, block.id)
  assertFinite('height', block.height, block.id)
  if (block.width < CANVAS_BLOCK_MIN_SIZE || block.height < CANVAS_BLOCK_MIN_SIZE) {
    throw blockError(
      'canvasBlockOutOfBounds',
      `A canvas block must be at least ${CANVAS_BLOCK_MIN_SIZE.toString()} points in each axis.`,
      block.id,
    )
  }
  if (
    block.x < 0 ||
    block.y < 0 ||
    block.x + block.width > pageWidth(page) ||
    block.y + block.height > pageHeight(page)
  ) {
    throw blockError('canvasBlockOutOfBounds', 'The canvas block leaves the page.', block.id)
  }
}

function assertTextBlockContent(block: CanvasBlock): void {
  if (block.text === null || block.text.trim() === '') {
    throw blockError('invalidFieldValue', 'A text block needs text.', block.id, ['text'])
  }
  if (countCodePoints(block.text) > CANVAS_BLOCK_MAX_TEXT_LENGTH) {
    throw blockError(
      'fieldTooLong',
      `A canvas text block may be at most ${CANVAS_BLOCK_MAX_TEXT_LENGTH.toString()} characters.`,
      block.id,
      ['text'],
    )
  }
  if (block.attachmentId !== null) {
    throw blockError('invalidFieldValue', 'A text block cannot carry an attachment.', block.id)
  }
  if (block.textStyle !== null) assertTextStyle(block.textStyle)
}

/** Divider and image blocks carry no text; image blocks need an attachment. */
function assertNonTextBlockContent(block: CanvasBlock): void {
  if (block.text !== null) {
    throw blockError('invalidFieldValue', `${block.kind} blocks carry no text.`, block.id)
  }
  if (block.kind === 'divider') {
    if (block.attachmentId !== null) {
      throw blockError('invalidFieldValue', 'A divider block cannot carry an attachment.', block.id)
    }
    return
  }
  if (block.attachmentId === null) {
    throw blockError('invalidFieldValue', 'An image block needs an attachment.', block.id, [
      'attachmentId',
    ])
  }
  if (block.textStyle !== null) {
    throw blockError('invalidFieldValue', 'An image block carries no text style.', block.id)
  }
}

/**
 * Validates the identity, layering and box rules of the whole canvas.
 *
 * @throws DomainError `invalidFieldValue` for duplicate ids and
 *   `canvasBlockOutOfBounds` for a block the page cannot hold.
 */
export function assertCanvasLayout(layout: CanvasLayout, page: PageSetup): void {
  const ids = new Set<string>()
  for (const block of layout.freeBlocks) {
    if (ids.has(block.id)) {
      throw blockError('invalidFieldValue', 'A canvas block id appears twice.', block.id, [
        block.id,
      ])
    }
    ids.add(block.id)
    assertCanvasBlock(block, page)
  }
}
