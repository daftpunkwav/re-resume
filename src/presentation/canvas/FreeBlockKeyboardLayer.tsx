/**
 * @file FreeBlockKeyboardLayer
 * @description The keyboard path over the canvas. Free text blocks are
 * focusable buttons that take their block's exact box, so focus lands where the
 * eye is; arrow keys nudge the selected block by one point and Shift by ten.
 *
 * Constraints:
 * - The layer is inert unless the document is editable.
 * - The buttons are transparent but not hidden: opacity would hide the focus
 *   ring as well.
 */

import type { KeyboardEvent } from 'react'

import type { CanvasBlock } from '../../domain/resume/CanvasLayout'
import type { LayoutBlockId } from '../../domain/shared/branded-id'
import {
  blockScreenRect,
  pageBoxOf,
  type CanvasMetrics,
  type ProjectedLayout,
} from './canvasProjection'

export interface FreeBlockKeyboardLayerProps {
  readonly projected: ProjectedLayout
  readonly metrics: CanvasMetrics
  readonly zoom: number
  readonly canvasBlocks: readonly CanvasBlock[]
  readonly selectedBlockId: LayoutBlockId | null
  readonly editable: boolean
  readonly onSelectBlock: (blockId: LayoutBlockId) => void
  readonly onNudgeBlock: (blockId: LayoutBlockId, dx: number, dy: number) => void
}

interface Nudge {
  readonly dx: number
  readonly dy: number
}

/** The nudge an arrow key asks for, or null for any other key. */
function arrowNudge(event: KeyboardEvent<HTMLButtonElement>): Nudge | null {
  const step = event.shiftKey ? 10 : 1
  switch (event.key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 }
    case 'ArrowRight':
      return { dx: step, dy: 0 }
    case 'ArrowUp':
      return { dx: 0, dy: -step }
    case 'ArrowDown':
      return { dx: 0, dy: step }
    default:
      return null
  }
}

function FreeBlockButton({
  block,
  layoutId,
  projected,
  metrics,
  zoom,
  selected,
  editable,
  onSelectBlock,
  onNudgeBlock,
}: {
  readonly block: CanvasBlock
  readonly layoutId: LayoutBlockId
  readonly projected: ProjectedLayout
  readonly metrics: CanvasMetrics
  readonly zoom: number
  readonly selected: boolean
  readonly editable: boolean
  readonly onSelectBlock: (blockId: LayoutBlockId) => void
  readonly onNudgeBlock: (blockId: LayoutBlockId, dx: number, dy: number) => void
}) {
  const projectedBlock = projected.blocks.find((candidate) => candidate.blockId === layoutId)
  if (projectedBlock === undefined) return null
  const pageBox = pageBoxOf(metrics, projectedBlock.pageIndex)
  if (pageBox === null) return null
  const rect = blockScreenRect(projectedBlock, pageBox, zoom)
  return (
    <button
      type="button"
      className={
        selected ? 'canvas-a11y-block canvas-a11y-block-selected' : 'canvas-a11y-block'
      }
      style={{
        left: `${rect.left.toString()}px`,
        top: `${rect.top.toString()}px`,
        width: `${Math.max(rect.width, 8).toString()}px`,
        height: `${Math.max(rect.height, 8).toString()}px`,
      }}
      aria-label={`自由文本块：${block.text ?? ''}`}
      onFocus={() => onSelectBlock(layoutId)}
      onKeyDown={(event) => {
        if (!editable) return
        const nudge = arrowNudge(event)
        if (nudge === null) return
        event.preventDefault()
        onNudgeBlock(layoutId, nudge.dx, nudge.dy)
      }}
    />
  )
}

export function FreeBlockKeyboardLayer({
  projected,
  metrics,
  zoom,
  canvasBlocks,
  selectedBlockId,
  editable,
  onSelectBlock,
  onNudgeBlock,
}: FreeBlockKeyboardLayerProps) {
  return (
    <div className="canvas-a11y-layer" aria-label="画布自由块">
      {canvasBlocks.map((block) => {
        if (block.kind !== 'text') return null
        const layoutId = `free:${block.id}` as LayoutBlockId
        return (
          <FreeBlockButton
            key={block.id}
            block={block}
            layoutId={layoutId}
            projected={projected}
            metrics={metrics}
            zoom={zoom}
            selected={selectedBlockId === layoutId}
            editable={editable}
            onSelectBlock={onSelectBlock}
            onNudgeBlock={onNudgeBlock}
          />
        )
      })}
    </div>
  )
}
