/**
 * @file ResumeCanvas
 * @description Draws one resume page as Konva shapes from the geometry layout()
 * already computed.
 *
 * Responsibilities:
 * - Project a LayoutOutput plus a zoom factor into positioned rectangles
 * - Own page navigation, the zoom factor and fit-to-width
 * - Turn one pointer gesture into exactly one intent, on release: a move
 *   (reorder or absolute placement) or an absolute block's resize
 * - Open the text editor over a double-clicked text block and hand its
 *   committed text back as an intent
 * - Report layout overflows instead of clipping them away
 *
 * Constraints:
 * - It must not measure text. A measureLine() call on this side would let the
 *   canvas engine disagree with the pagination and move a page break on one
 *   platform and not on the other, so every line is drawn at the position and
 *   width layout() produced and wrap is switched off on the text nodes.
 * - It must not change the document. A drop and a text commit are reported as
 *   intents; the editor turns them into DocumentChanges and commits them
 *   through the composition root.
 * - One stage unit is one CSS pixel. Konva multiplies the stage's backing store
 *   by window.devicePixelRatio itself, which is what keeps the sheet sharp on a
 *   fractional display; the geometry below therefore carries the zoom and the
 *   stage carries none.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Group, Layer, Rect, Stage, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'

import { Button } from '../app/components/Button'
import { Notice } from '../app/components/Notice'
import { TextEditorOverlay } from './TextEditorOverlay'
import type { Block } from '../../domain/resume/Block'
import { isAbsoluteLayout } from '../../domain/resume/Layout'
import type { AbsoluteLayout } from '../../domain/resume/Layout'
import type { LaidOutBlock, LayoutOutput, OverflowReport } from '../../domain/resume/PageLayout'
import type { PageSetup } from '../../domain/resume/PageSetup'
import type { BlockId } from '../../domain/shared/branded-id'

import './canvas.css'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 3
export const ZOOM_STEP = 0.1

/** Breathing room between the fitted page and the edge of the viewport. */
const FIT_PADDING = 48
const MIN_STAGE_SIZE = 240
const SHADOW_BLUR = 18
const SHADOW_OFFSET_Y = 6
const SHADOW_OPACITY = 0.16
const SELECTION_FILL_OPACITY = 0.08
const SELECTION_STROKE_WIDTH = 1
const RESIZE_HANDLE_SIZE = 8

export interface CanvasPoint {
  readonly x: number
  readonly y: number
}

/** One precomputed line, in screen pixels, with the style layout() resolved. */
export interface CanvasTextLine {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly fontSize: number
  readonly fontFamily: string
  readonly fontWeight: number
}

export interface CanvasBlockBox {
  readonly blockId: BlockId
  readonly pageIndex: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** A divider draws a rule rather than text; a graphic draws neither. */
  readonly rule: boolean
  readonly lines: readonly CanvasTextLine[]
}

export interface CanvasSheet {
  readonly pageIndex: number
  readonly width: number
  readonly height: number
  readonly blocks: readonly CanvasBlockBox[]
}

/** A completed pointer gesture, expressed the way the editor has to act on it. */
export type BlockGesture =
  | {
      readonly kind: 'reorder'
      readonly blockId: BlockId
      /** The flow block the drop landed before; null lands at the end. */
      readonly beforeBlockId: BlockId | null
    }
  | { readonly kind: 'place'; readonly blockId: BlockId; readonly x: number; readonly y: number }
  | {
      readonly kind: 'resize'
      readonly blockId: BlockId
      readonly width: number
      readonly height: number
    }

export interface ResumeCanvasProps {
  readonly layout: LayoutOutput
  readonly page: PageSetup
  /** Live blocks: the layout mode of a gesture, the shape of a divider, the text a double click edits. */
  readonly blocks: readonly Block[]
  readonly editable: boolean
  readonly selectedBlockId: BlockId | null
  readonly onSelectBlock: (blockId: BlockId | null) => void
  readonly onGesture: (gesture: BlockGesture) => void
  /** The committed text of an editing session, as an intent for the editor. */
  readonly onEditText: (blockId: BlockId, text: string) => void
}

/**
 * Lays the computed output out in screen pixels. Points reach the margins, the
 * zoom converts them, and each line lands at its own x rather than at the
 * block's left edge.
 */
export function projectLayoutToSheets(
  layout: LayoutOutput,
  blocks: readonly Block[],
  page: PageSetup,
  zoom: number,
): readonly CanvasSheet[] {
  const boxesByPage = new Map<number, CanvasBlockBox[]>()
  for (const laidOut of layout.blocks) {
    const box = projectBlock(laidOut, blocks, page, zoom)
    const existing = boxesByPage.get(laidOut.pageIndex)
    if (existing === undefined) boxesByPage.set(laidOut.pageIndex, [box])
    else existing.push(box)
  }
  return layout.pages.map((entry) => ({
    pageIndex: entry.pageIndex,
    width: page.pageWidth * zoom,
    height: page.pageHeight * zoom,
    blocks: boxesByPage.get(entry.pageIndex) ?? [],
  }))
}

function projectBlock(
  laidOut: LaidOutBlock,
  blocks: readonly Block[],
  page: PageSetup,
  zoom: number,
): CanvasBlockBox {
  const { fontFamily, fontSize, fontWeight, lineHeight } = laidOut.textStyle
  const left = (page.marginLeft + laidOut.x) * zoom
  const top = (page.marginTop + laidOut.y) * zoom
  const step = fontSize * lineHeight * zoom
  return {
    blockId: laidOut.blockId,
    pageIndex: laidOut.pageIndex,
    x: left,
    y: top,
    width: laidOut.width * zoom,
    height: laidOut.height * zoom,
    rule: drawsRule(laidOut, blocks),
    lines: laidOut.lines.map((line, index) => ({
      text: line.text,
      x: left + line.x * zoom,
      y: top + step * index,
      width: line.width * zoom,
      height: step,
      fontSize: fontSize * zoom,
      fontFamily,
      fontWeight,
    })),
  }
}

function drawsRule(laidOut: LaidOutBlock, blocks: readonly Block[]): boolean {
  const source = blocks.find((block) => block.id === laidOut.blockId)
  return source !== undefined && source.content.type === 'divider'
}

/** Screen pixels back to the content box layout() measured against. */
export function contentPointFromSheet(
  point: CanvasPoint,
  page: PageSetup,
  zoom: number,
): CanvasPoint {
  return { x: point.x / zoom - page.marginLeft, y: point.y / zoom - page.marginTop }
}

/**
 * Where a flow block lands. The block leaves the sequence and is reinserted
 * before the first remaining block whose vertical midpoint is below the
 * pointer. The list handed in holds the flow blocks in document order —
 * absolute blocks are not part of the sequence and say nothing about where it
 * continues — so the answer is an anchor the editor can splice against, not an
 * index that depends on where absolute blocks happen to sit.
 */
export function reorderAnchorForDrop(
  laidOutFlowBlocks: readonly LaidOutBlock[],
  draggedBlockId: BlockId,
  contentPointerY: number,
): BlockId | null {
  const remaining = laidOutFlowBlocks.filter((block) => block.blockId !== draggedBlockId)
  for (const block of remaining) {
    if (contentPointerY < block.y + block.height / 2) return block.blockId
  }
  return null
}

/**
 * The pointer cannot put a block where the sheet has no paper: an absolute
 * block is kept inside the content box, and layout() stays responsible for
 * reporting a block that arrives out of bounds from elsewhere.
 */
export function clampAbsolutePoint(
  page: PageSetup,
  box: AbsoluteLayout,
  point: CanvasPoint,
): CanvasPoint {
  const maxX = Math.max(0, page.pageWidth - page.marginLeft - page.marginRight - box.width)
  const maxY = Math.max(0, page.pageHeight - page.marginTop - page.marginBottom - box.height)
  return {
    x: Math.min(Math.max(point.x, 0), maxX),
    y: Math.min(Math.max(point.y, 0), maxY),
  }
}

/** Smallest box a resize can produce, in points: a block one can still grab. */
export const MIN_ABSOLUTE_SIZE = 24

/**
 * The corner cannot stretch a block past the content box or collapse it to
 * nothing. Measured in content points, where the block's own box lives.
 */
export function clampResizeSize(
  page: PageSetup,
  box: AbsoluteLayout,
  width: number,
  height: number,
): { readonly width: number; readonly height: number } {
  const maxWidth = Math.max(
    MIN_ABSOLUTE_SIZE,
    page.pageWidth - page.marginLeft - page.marginRight - box.x,
  )
  const maxHeight = Math.max(
    MIN_ABSOLUTE_SIZE,
    page.pageHeight - page.marginTop - page.marginBottom - box.y,
  )
  return {
    width: Math.min(Math.max(width, MIN_ABSOLUTE_SIZE), maxWidth),
    height: Math.min(Math.max(height, MIN_ABSOLUTE_SIZE), maxHeight),
  }
}

export function fitWidthZoom(pageWidth: number, viewportWidth: number): number {
  const available = viewportWidth - FIT_PADDING * 2
  if (!(available > 0)) return MIN_ZOOM
  return Math.min(Math.max(available / pageWidth, MIN_ZOOM), MAX_ZOOM)
}

export function describeOverflow(reason: OverflowReport['reason']): string {
  return reason === 'block-taller-than-page'
    ? '这个区块比一页还高，没有自动缩放。'
    : '绝对定位的区块超出了页面的内容区。'
}

/**
 * Theme colours reach the canvas as CSS custom properties, because a Konva
 * shape cannot carry a class. A token that resolves to nothing leaves the
 * decoration off rather than inventing a colour.
 */
function readThemeToken(name: string): string | null {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? null : value
}

interface Viewport {
  readonly width: number
  readonly height: number
}

export function ResumeCanvas({
  layout,
  page,
  blocks,
  editable,
  selectedBlockId,
  onSelectBlock,
  onGesture,
  onEditText,
}: ResumeCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  // A null override means "follow the viewport", which is what fit-to-width
  // is: the zoom is derived rather than held, so a resize re-fits instead of
  // stretching a drawing that was measured for a different width.
  const [zoomOverride, setZoomOverride] = useState<number | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 })
  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    const host = viewportRef.current
    if (host === null) return
    const measure = (): void => {
      const rect = host.getBoundingClientRect()
      setViewport({ width: Math.round(rect.width), height: Math.round(rect.height) })
    }
    measure()
    window.addEventListener('resize', measure)
    // The window is not the only thing that resizes the frame: a pane opening
    // beside it, a sidebar collapsing or a zoom change all move the host's box
    // without a window resize ever firing. Fit-to-width reads the host width,
    // so a stale measurement leaves the zoom describing a width that is no
    // longer there.
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [])

  const zoom = zoomOverride ?? fitWidthZoom(page.pageWidth, viewport.width)
  const sheets = useMemo(
    () => projectLayoutToSheets(layout, blocks, page, zoom),
    [blocks, layout, page, zoom],
  )
  const pageCount = sheets.length
  const activeIndex = pageCount === 0 ? 0 : Math.min(pageIndex, pageCount - 1)
  const sheet = sheets[activeIndex]

  const paperFill = readThemeToken('--surface-raised')
  const inkColour = readThemeToken('--text-primary')
  const accentColour = readThemeToken('--accent')
  const ruleColour = readThemeToken('--border-strong')

  /**
   * The id of the block currently under the pointer. Held in a ref rather than
   * state because the drag handlers below run per pointer move and only the
   * release needs to know which block the gesture belonged to.
   */
  const draggedBlockId = useRef<BlockId | null>(null)

  const beginDrag = useCallback((blockId: BlockId): void => {
    draggedBlockId.current = blockId
  }, [])

  /**
   * The block whose text is being edited. The overlay replaces the drawn lines
   * for exactly this block until the session commits or is cancelled. A stale
   * id is harmless: every reader below requires the block to still exist, so
   * an undo that removes it just closes the editor.
   */
  const [editingBlockId, setEditingBlockId] = useState<BlockId | null>(null)

  const beginEdit = useCallback(
    (box: CanvasBlockBox): void => {
      const live = blocks.find((block) => block.id === box.blockId)
      if (!editable || live === undefined || live.content.type !== 'text') return
      onSelectBlock(box.blockId)
      setEditingBlockId(box.blockId)
    },
    [blocks, editable, onSelectBlock],
  )

  const commitEdit = useCallback(
    (text: string): void => {
      const blockId = editingBlockId
      setEditingBlockId(null)
      if (blockId === null) return
      const live = blocks.find((block) => block.id === blockId)
      // An unchanged session writes no revision: closing the editor is not an
      // edit, and the revision chain should not record one.
      if (live === undefined || live.content.type !== 'text' || live.content.text === text) return
      onEditText(blockId, text)
    },
    [blocks, editingBlockId, onEditText],
  )

  const cancelEdit = useCallback((): void => {
    setEditingBlockId(null)
  }, [])

  /**
   * A gesture becomes a drop intent exactly once, here. The move handler is
   * deliberately absent: Konva already moves the node while the pointer moves,
   * and turning every intermediate position into a change would write one
   * revision per frame instead of one per gesture.
   */
  const endDrag = useCallback(
    (box: CanvasBlockBox, event: KonvaEventObject<DragEvent>): void => {
      const blockId = draggedBlockId.current
      draggedBlockId.current = null
      const node = event.target
      const landing: CanvasPoint = { x: node.x(), y: node.y() }
      // The layout is authoritative until the commit returns; putting the node
      // back now keeps the drawing from claiming a position the document does
      // not hold yet.
      node.position({ x: box.x, y: box.y })
      if (blockId === null || blockId !== box.blockId) return
      const laidOut = layout.blocks.find((entry) => entry.blockId === blockId)
      const live = blocks.find((entry) => entry.id === blockId)
      if (laidOut === undefined || live === undefined) return
      const content = contentPointFromSheet(landing, page, zoom)
      if (isAbsoluteLayout(live.layout)) {
        const placed = clampAbsolutePoint(page, live.layout, content)
        onGesture({ kind: 'place', blockId, x: placed.x, y: placed.y })
        return
      }
      // The flow blocks, in document order, each with the geometry layout()
      // drew for it: the list a drop anchor is read from.
      const flowLaidOut = blocks
        .filter((entry) => !isAbsoluteLayout(entry.layout))
        .flatMap((entry) => {
          const drawn = layout.blocks.find((laidOut) => laidOut.blockId === entry.id)
          return drawn === undefined ? [] : [drawn]
        })
      onGesture({
        kind: 'reorder',
        blockId,
        // The anchor compares the drop point against the middle of every
        // remaining flow block, so the dragged block has to be measured the
        // same way. Its top edge says the block lands later than it does: a
        // tall block dropped just above its neighbour looked like it belonged
        // below it.
        beforeBlockId: reorderAnchorForDrop(
          flowLaidOut,
          blockId,
          content.y + laidOut.height / 2,
        ),
      })
    },
    [blocks, layout, onGesture, page, zoom],
  )

  /**
   * The corner whose drag is stretching an absolute block. Same ref pattern as
   * the move drag: the moves belong to the gesture, the release belongs to the
   * document.
   */
  const resizingCorner = useRef<BlockId | null>(null)

  const beginResize = useCallback((blockId: BlockId): void => {
    resizingCorner.current = blockId
  }, [])

  const endResize = useCallback(
    (box: CanvasBlockBox, event: KonvaEventObject<DragEvent>): void => {
      const blockId = resizingCorner.current
      resizingCorner.current = null
      const node = event.target
      const corner: CanvasPoint = { x: node.x(), y: node.y() }
      node.position({ x: box.x + box.width, y: box.y + box.height })
      if (blockId === null || blockId !== box.blockId) return
      const live = blocks.find((entry) => entry.id === blockId)
      if (live === undefined || !isAbsoluteLayout(live.layout)) return
      const size = clampResizeSize(page, live.layout, corner.x - box.x, corner.y - box.y)
      onGesture({ kind: 'resize', blockId, width: size.width, height: size.height })
    },
    [blocks, onGesture, page],
  )

  const changeZoom = (delta: number): void => {
    setZoomOverride(Math.min(Math.max(zoom + delta, MIN_ZOOM), MAX_ZOOM))
  }

  /**
   * The corner that stretches an absolute block, or nothing for a flow block:
   * its height belongs to its content, not to the pointer. The handle is a
   * screen-space square, so it stays grabbable at every zoom.
   */
  const renderResizeHandle = (box: CanvasBlockBox): ReactNode => {
    if (!editable || editingBlockId === box.blockId) return null
    const live = blocks.find((entry) => entry.id === box.blockId)
    if (live === undefined || !isAbsoluteLayout(live.layout)) return null
    return (
      <Rect
        name={`resize-${box.blockId}`}
        x={box.x + box.width}
        y={box.y + box.height}
        width={RESIZE_HANDLE_SIZE}
        height={RESIZE_HANDLE_SIZE}
        draggable
        onDragStart={() => beginResize(box.blockId)}
        onDragEnd={(event) => endResize(box, event)}
        onClick={() => onSelectBlock(box.blockId)}
        fill={accentColour ?? undefined}
      />
    )
  }

  /**
   * The overlay for the open editing session, or nothing. The geometry comes
   * from the same projection the drawn box uses, so the textarea lands exactly
   * where the lines it replaces were.
   */
  const textEditor = (): ReactNode => {
    if (editingBlockId === null || sheet === undefined) return null
    const box = sheet.blocks.find((entry) => entry.blockId === editingBlockId)
    const live = blocks.find((entry) => entry.id === editingBlockId)
    if (box === undefined || live === undefined || live.content.type !== 'text') return null
    const style = layout.blocks.find((entry) => entry.blockId === editingBlockId)?.textStyle
    if (style === undefined) return null
    const fontSize = style.fontSize * zoom
    const step = fontSize * style.lineHeight
    return (
      <TextEditorOverlay
        initialText={live.content.text}
        transform={{
          x: box.x,
          y: box.y,
          scale: zoom,
          width: box.width,
          height: Math.max(box.height, step),
        }}
        fontSize={fontSize}
        lineHeight={step}
        fontFamily={style.fontFamily}
        onCommit={commitEdit}
        onCancel={cancelEdit}
      />
    )
  }

  return (
    <div className="canvas-frame">
      <div className="toolbar canvas-controls">
        <div className="toolbar-group">
          <Button
            size="small"
            onClick={() => setPageIndex(Math.max(0, activeIndex - 1))}
            disabled={activeIndex <= 0}
          >
            上一页
          </Button>
          <span className="canvas-page-indicator">
            {pageCount === 0 ? '— / —' : `${activeIndex + 1} / ${pageCount}`}
          </span>
          <Button
            size="small"
            onClick={() => setPageIndex(Math.min(pageCount - 1, activeIndex + 1))}
            disabled={activeIndex >= pageCount - 1}
          >
            下一页
          </Button>
        </div>
        <div className="toolbar-group">
          <Button size="small" onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>
            缩小
          </Button>
          <span className="canvas-zoom-readout">{Math.round(zoom * 100)}%</span>
          <Button size="small" onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>
            放大
          </Button>
          <Button size="small" variant="ghost" onClick={() => setZoomOverride(null)}>
            适应宽度
          </Button>
        </div>
      </div>

      {layout.overflows.length === 0 ? null : (
        <Notice tone="warning" title={`${layout.overflows.length} 个区块放不进这一页`}>
          <p>溢出会被记录下来，而不是被悄悄裁掉：</p>
          <ul className="canvas-overflow-list">
            {layout.overflows.map((report) => (
              <li key={report.blockId} className="canvas-overflow-row">
                {report.blockId} — {describeOverflow(report.reason)}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="canvas-viewport" ref={viewportRef}>
        {sheet === undefined ? (
          <p className="canvas-empty">文档还没有内容，从右侧添加一个区块。</p>
        ) : (
          <div className="canvas-stage-host">
            <Stage
              className="canvas-stage"
              width={Math.max(viewport.width, MIN_STAGE_SIZE)}
              height={Math.max(viewport.height, MIN_STAGE_SIZE)}
            >
              <Layer listening={false}>
                <Rect
                  x={0}
                  y={0}
                  width={sheet.width}
                  height={sheet.height}
                  cornerRadius={2}
                  fill={paperFill ?? undefined}
                  shadowColor={inkColour ?? undefined}
                  shadowBlur={SHADOW_BLUR}
                  shadowOffsetY={SHADOW_OFFSET_Y}
                  shadowOpacity={SHADOW_OPACITY}
                />
                {sheet.blocks.map((box) =>
                  box.rule ? (
                    <Rect
                      key={box.blockId}
                      x={box.x}
                      y={box.y}
                      width={box.width}
                      height={box.height}
                      fill={ruleColour ?? undefined}
                    />
                  ) : null,
                )}
              </Layer>

              <Layer>
                {/* Drawn first so it sits behind the blocks: Konva hit-tests from
                    the top down, and a full-sheet rect on top would swallow every
                    click on a block. */}
                <Rect
                  x={0}
                  y={0}
                  width={sheet.width}
                  height={sheet.height}
                  onClick={() => onSelectBlock(null)}
                  onTap={() => onSelectBlock(null)}
                />
                {sheet.blocks.map((box) => (
                  <Group key={box.blockId}>
                    <Rect
                      name={box.blockId}
                      x={box.x}
                      y={box.y}
                      width={box.width}
                      height={box.height}
                      // An open editor sits on top of the node; dragging under a
                      // live textarea would move the box out from the text.
                      draggable={editable && box.blockId !== editingBlockId}
                      onDragStart={() => beginDrag(box.blockId)}
                      onDragEnd={(event) => endDrag(box, event)}
                      onClick={() => onSelectBlock(box.blockId)}
                      onTap={() => onSelectBlock(box.blockId)}
                      onDblClick={() => beginEdit(box)}
                      onDblTap={() => beginEdit(box)}
                      fill={accentColour ?? undefined}
                      opacity={box.blockId === selectedBlockId ? SELECTION_FILL_OPACITY : 0}
                      stroke={box.blockId === selectedBlockId ? (accentColour ?? undefined) : undefined}
                      strokeWidth={SELECTION_STROKE_WIDTH}
                    />
                    {box.lines.map((line, index) =>
                      box.blockId === editingBlockId ? null : (
                        <Text
                          key={`${box.blockId}-${index}`}
                          text={line.text}
                          x={line.x}
                          y={line.y}
                          width={line.width}
                          height={line.height}
                          fontSize={line.fontSize}
                          fontFamily={line.fontFamily}
                          // The canvas font shorthand carries two weights, so a
                          // resolved weight above the default collapses to bold.
                          fontStyle={line.fontWeight > 500 ? 'bold' : 'normal'}
                          fill={inkColour ?? undefined}
                          // wrap: none keeps the text node from re-wrapping a line
                          // layout() has already broken.
                          wrap="none"
                          listening={false}
                        />
                      ),
                    )}
                    {renderResizeHandle(box)}
                  </Group>
                ))}
              </Layer>
            </Stage>

            {textEditor()}
          </div>
        )}
      </div>
    </div>
  )
}
