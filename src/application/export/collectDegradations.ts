/**
 * @file collectDegradations
 * @description DOCX cannot express everything the document model allows. Every
 * fallback is listed here so the export result carries the list rather than
 * silently rearranging the page.
 *
 * Fallback rule, applied in this order:
 * - A graphic degrades wherever it sits: DOCX image support is unverified, so
 *   the block keeps its content position and nothing is embedded.
 * - A rotated absolute block degrades twice: the position and the rotation are
 *   separate capabilities, and dropping the rotation is not implied by dropping
 *   the position.
 * - An absolute block falls back by what its content can become in a document
 *   flow: a text-bearing block becomes a single-cell table, a divider becomes
 *   a paragraph border, and anything else has no mapping and keeps content
 *   order.
 *
 * Constraints:
 * - This function reads blocks only. It must not change them.
 */

import { isAbsoluteLayout } from '../../domain/resume/Layout'
import type { Block, BlockContent } from '../../domain/resume/Block'
import type { BlockId } from '../../domain/shared/branded-id'

export interface DegradedBlock {
  readonly blockId: BlockId
  readonly reason: 'absolute-layout-unsupported' | 'graphic-unsupported' | 'rotation-unsupported'
  readonly appliedFallback: 'table' | 'border' | 'flow-order'
}

export function collectDegradations(blocks: readonly Block[]): readonly DegradedBlock[] {
  const degradations: DegradedBlock[] = []
  for (const block of blocks) {
    if (block.content.type === 'graphic') {
      degradations.push({
        blockId: block.id,
        reason: 'graphic-unsupported',
        appliedFallback: 'flow-order',
      })
    }
    if (!isAbsoluteLayout(block.layout)) continue
    degradations.push({
      blockId: block.id,
      reason: 'absolute-layout-unsupported',
      appliedFallback: absoluteFallback(block.content),
    })
    if (block.layout.rotation !== 0) {
      degradations.push({
        blockId: block.id,
        reason: 'rotation-unsupported',
        appliedFallback: 'flow-order',
      })
    }
  }
  return degradations
}

function absoluteFallback(content: BlockContent): DegradedBlock['appliedFallback'] {
  if (content.type === 'divider') return 'border'
  if (content.type === 'graphic') return 'flow-order'
  return 'table'
}
