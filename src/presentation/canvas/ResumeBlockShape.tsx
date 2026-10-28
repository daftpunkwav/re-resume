/**
 * @file ResumeBlockShape
 * @description One drawable block on the canvas: its selection, agent and
 * overflow hints, its painted content and its hit area. Each concern is a small
 * component so the block itself stays an ordered composition of them.
 *
 * Constraints:
 * - Draw order is the contract: highlight, content, hit area, selection,
 *   overflow. Konva paints later children above earlier ones.
 * - The hit area is transparent and listening; every other shape ignores the
 *   pointer, so a click anywhere on the block selects it.
 */

import { Group, Line as KonvaLine, Rect, Text as KonvaText } from 'react-konva'

import type { LayoutBlockId } from '../../domain/shared/branded-id'
import type { ProjectedBlock } from './canvasProjection'
import {
  INK,
  MISSING_COLOUR,
  OVERFLOW_COLOUR,
  fontFamilyOf,
} from './canvasStyle'

interface BlockFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface BlockGeometry {
  readonly block: ProjectedBlock
  readonly pageTop: number
  readonly zoom: number
}

export interface ResumeBlockShapeProps {
  readonly block: ProjectedBlock
  readonly pageTop: number
  readonly zoom: number
  readonly selected: boolean
  readonly agentHighlighted: boolean
  readonly overflow: boolean
  readonly accent: string
  readonly editable: boolean
  readonly editorOpen: boolean
  readonly onSelectBlock: (blockId: LayoutBlockId) => void
  readonly onOpenEditor: (blockId: LayoutBlockId) => void
}

function frameOf({ block, pageTop, zoom }: BlockGeometry): BlockFrame {
  return {
    x: block.x * zoom,
    y: pageTop + block.y * zoom,
    width: block.width * zoom,
    height: Math.max(block.height * zoom, 1),
  }
}

function AgentHighlight({ frame, accent }: { readonly frame: BlockFrame; readonly accent: string }) {
  return (
    <Rect
      x={frame.x - 4}
      y={frame.y}
      width={2}
      height={frame.height}
      fill={accent}
      listening={false}
    />
  )
}

function DividerShape({ frame, zoom }: { readonly frame: BlockFrame; readonly zoom: number }) {
  return (
    <Rect
      x={frame.x}
      y={frame.y}
      width={frame.width}
      height={Math.max(1, zoom)}
      fill={INK}
      listening={false}
    />
  )
}

function ImageFrame({
  frame,
  zoom,
  missing,
}: {
  readonly frame: BlockFrame
  readonly zoom: number
  readonly missing: boolean
}) {
  return (
    <>
      <Rect
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        stroke={missing ? MISSING_COLOUR : '#cbd5e1'}
        strokeWidth={1}
        dash={missing ? [4, 3] : undefined}
        cornerRadius={2}
        fill={missing ? undefined : '#f3f4f6'}
        listening={false}
      />
      <KonvaText
        x={frame.x}
        y={frame.y + Math.max(0, frame.height / 2 - 6 * zoom)}
        width={frame.width}
        align="center"
        text={missing ? '图片缺失' : '图片'}
        fontSize={9 * zoom}
        fontFamily={fontFamilyOf('Noto Sans SC')}
        fill={missing ? MISSING_COLOUR : '#64748b'}
        listening={false}
      />
    </>
  )
}

function BlockTextLines({ block, pageTop, zoom }: BlockGeometry) {
  return (
    <>
      {block.lines.map((line, index) => {
        if (line.text === '') return null
        return (
          <KonvaText
            key={`${block.blockId}-line-${index.toString()}`}
            x={(block.x + line.x) * zoom}
            y={pageTop + (block.y + line.top) * zoom}
            text={line.text}
            fontSize={line.style.fontSize * zoom}
            fontFamily={fontFamilyOf(line.style.fontFamily)}
            fontStyle={line.style.fontWeight >= 700 ? 'bold' : 'normal'}
            fill={INK}
            wrap="none"
            listening={false}
            perfectDrawEnabled={false}
          />
        )
      })}
    </>
  )
}

function BlockHitArea({
  frame,
  blockId,
  editable,
  onSelectBlock,
  onOpenEditor,
}: {
  readonly frame: BlockFrame
  readonly blockId: LayoutBlockId
  readonly editable: boolean
  readonly onSelectBlock: (blockId: LayoutBlockId) => void
  readonly onOpenEditor: (blockId: LayoutBlockId) => void
}) {
  return (
    <Rect
      x={frame.x}
      y={frame.y}
      width={frame.width}
      height={frame.height}
      fill="rgba(0,0,0,0)"
      onClick={(event) => {
        event.cancelBubble = true
        onSelectBlock(blockId)
      }}
      onTap={(event) => {
        event.cancelBubble = true
        onSelectBlock(blockId)
      }}
      onDblClick={(event) => {
        event.cancelBubble = true
        if (editable) onOpenEditor(blockId)
      }}
      onDblTap={(event) => {
        event.cancelBubble = true
        if (editable) onOpenEditor(blockId)
      }}
    />
  )
}

function SelectionOutline({ frame, accent }: { readonly frame: BlockFrame; readonly accent: string }) {
  return (
    <Rect
      x={frame.x - 1}
      y={frame.y - 1}
      width={frame.width + 2}
      height={frame.height + 2}
      stroke={accent}
      strokeWidth={1.4}
      listening={false}
    />
  )
}

function OverflowOutline({ block, pageTop, zoom }: BlockGeometry) {
  const right = block.x * zoom + block.width * zoom
  return (
    <>
      <Rect
        x={block.x * zoom}
        y={pageTop + block.y * zoom}
        width={block.width * zoom}
        height={Math.max(block.height * zoom, 1)}
        stroke={OVERFLOW_COLOUR}
        strokeWidth={1.4}
        dash={[4, 3]}
        listening={false}
      />
      <KonvaLine
        points={[right - 8, pageTop + block.y * zoom + 2, right, pageTop + block.y * zoom + 2, right - 4, pageTop + block.y * zoom + 10]}
        closed
        fill={OVERFLOW_COLOUR}
        listening={false}
      />
    </>
  )
}

export function ResumeBlockShape({
  block,
  pageTop,
  zoom,
  selected,
  agentHighlighted,
  overflow,
  accent,
  editable,
  editorOpen,
  onSelectBlock,
  onOpenEditor,
}: ResumeBlockShapeProps) {
  const geometry: BlockGeometry = { block, pageTop, zoom }
  const frame = frameOf(geometry)
  const image = block.image

  return (
    <Group>
      {agentHighlighted ? <AgentHighlight frame={frame} accent={accent} /> : null}
      {block.role === 'divider' ? <DividerShape frame={frame} zoom={zoom} /> : null}
      {block.role === 'image' ? <ImageFrame frame={frame} zoom={zoom} missing={image === null} /> : null}
      {block.role !== 'image' && !editorOpen ? <BlockTextLines {...geometry} /> : null}
      <BlockHitArea
        frame={frame}
        blockId={block.blockId}
        editable={editable}
        onSelectBlock={onSelectBlock}
        onOpenEditor={onOpenEditor}
      />
      {selected ? <SelectionOutline frame={frame} accent={accent} /> : null}
      {overflow ? <OverflowOutline {...geometry} /> : null}
    </Group>
  )
}
