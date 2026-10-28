/**
 * @file ResumeCanvas
 * @description Draws the laid-out resume with Konva. It never measures, wraps
 * or paginates: every coordinate, line break and page comes from the projected
 * `LayoutOutput`, which is the same source the PDF exporter will read. One
 * canvas unit is one CSS pixel; the stage transform is the zoom.
 *
 * Responsibilities:
 * - One paper group per page with its shadow and page number
 * - Text lines, dividers, image placeholders and canvas free blocks
 * - Selection, section highlight and the agent highlight
 * - Overflow markers and the missing-image frame
 * - A keyboard-reachable layer over free blocks (Tab + arrow-key nudges)
 *
 * Constraints:
 * - No document edits: clicks call the callbacks; the store owns the writes.
 * - The accessibility layer is DOM, not canvas, because a canvas pixel cannot
 *   receive focus or carry a name.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Group, Layer, Line as KonvaLine, Rect, Stage, Text as KonvaText } from 'react-konva'

import type { CanvasBlock } from '../../domain/resume/CanvasLayout'
import type { MaterializedDocument } from '../../domain/resume/ResumeSnapshot'
import type { LayoutOutput } from '../../domain/resume/PageLayout'
import type { PageSetup } from '../../domain/resume/PageSetup'
import { cssFamilyName } from '../../domain/resume/TextStyle'
import type { LayoutBlockId, ResumeSectionId } from '../../domain/shared/branded-id'
import type { StudioSelection } from '../features/resume/resumeStore'
import {
  blockScreenRect,
  canvasMetrics,
  pageBoxOf,
  projectResume,
  type ProjectedBlock,
} from './canvasProjection'

const PAPER_FILL = '#ffffff'
const INK = '#1b1d21'
const SELECTION_FALLBACK = '#2563eb'
const OVERFLOW_COLOUR = '#dc2626'
const MISSING_COLOUR = '#9a3412'
const PAGE_GAP = 24

/** Family declaration a Konva text node can use; the bundled face plus a system fallback. */
function fontFamilyOf(family: string): string {
  return `${cssFamilyName(family)}, "Microsoft YaHei", "PingFang SC", sans-serif`
}

export interface ResumeCanvasProps {
  readonly materialized: MaterializedDocument
  readonly layout: LayoutOutput
  readonly page: PageSetup
  readonly zoom: number
  readonly selection: StudioSelection
  readonly highlightedSectionIds: readonly ResumeSectionId[]
  readonly editorBlockId: LayoutBlockId | null
  readonly editable: boolean
  readonly canvasBlocks: readonly CanvasBlock[]
  readonly blockSectionIds: ReadonlyMap<LayoutBlockId, ResumeSectionId>
  readonly onSelectBlock: (blockId: LayoutBlockId) => void
  readonly onOpenEditor: (blockId: LayoutBlockId) => void
  readonly onBackground: () => void
  readonly onNudgeBlock: (blockId: LayoutBlockId, dx: number, dy: number) => void
}

function BlockShape({
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
}: {
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
}) {
  const x = block.x * zoom
  const y = pageTop + block.y * zoom
  const width = block.width * zoom
  const height = Math.max(block.height * zoom, 1)

  return (
    <Group>
      {agentHighlighted ? (
        <Rect
          x={x - 4}
          y={y}
          width={2}
          height={height}
          fill={accent}
          listening={false}
        />
      ) : null}
      {block.role === 'divider' ? (
        <Rect x={x} y={y} width={width} height={Math.max(1, zoom)} fill={INK} listening={false} />
      ) : null}
      {block.image === null && block.role === 'image' ? (
        <>
          <Rect
            x={x}
            y={y}
            width={width}
            height={height}
            stroke={MISSING_COLOUR}
            strokeWidth={1}
            dash={[4, 3]}
            cornerRadius={2}
            listening={false}
          />
          <KonvaText
            x={x}
            y={y + Math.max(0, height / 2 - 6 * zoom)}
            width={width}
            align="center"
            text="图片缺失"
            fontSize={9 * zoom}
            fontFamily={fontFamilyOf('Noto Sans SC')}
            fill={MISSING_COLOUR}
            listening={false}
          />
        </>
      ) : null}
      {block.image !== null ? (
        <>
          <Rect
            x={x}
            y={y}
            width={width}
            height={height}
            fill="#f3f4f6"
            stroke="#cbd5e1"
            strokeWidth={1}
            cornerRadius={2}
            listening={false}
          />
          <KonvaText
            x={x}
            y={y + Math.max(0, height / 2 - 6 * zoom)}
            width={width}
            align="center"
            text="图片"
            fontSize={9 * zoom}
            fontFamily={fontFamilyOf('Noto Sans SC')}
            fill="#64748b"
            listening={false}
          />
        </>
      ) : null}
      {block.role !== 'image' && !editorOpen ? (
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
      ) : null}
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="rgba(0,0,0,0)"
        onClick={(event) => {
          event.cancelBubble = true
          onSelectBlock(block.blockId)
        }}
        onTap={(event) => {
          event.cancelBubble = true
          onSelectBlock(block.blockId)
        }}
        onDblClick={(event) => {
          event.cancelBubble = true
          if (editable) onOpenEditor(block.blockId)
        }}
        onDblTap={(event) => {
          event.cancelBubble = true
          if (editable) onOpenEditor(block.blockId)
        }}
      />
      {selected ? (
        <Rect
          x={x - 1}
          y={y - 1}
          width={width + 2}
          height={height + 2}
          stroke={accent}
          strokeWidth={1.4}
          listening={false}
        />
      ) : null}
      {overflow ? (
        <>
          <Rect
            x={x}
            y={y}
            width={width}
            height={height}
            stroke={OVERFLOW_COLOUR}
            strokeWidth={1.4}
            dash={[4, 3]}
            listening={false}
          />
          <KonvaLine
            points={[
              block.x * zoom + block.width * zoom - 8,
              pageTop + block.y * zoom + 2,
              block.x * zoom + block.width * zoom,
              pageTop + block.y * zoom + 2,
              block.x * zoom + block.width * zoom - 4,
              pageTop + block.y * zoom + 10,
            ]}
            closed
            fill={OVERFLOW_COLOUR}
            listening={false}
          />
        </>
      ) : null}
    </Group>
  )
}

export function ResumeCanvas({
  materialized,
  layout,
  page,
  zoom,
  selection,
  highlightedSectionIds,
  editorBlockId,
  editable,
  canvasBlocks,
  blockSectionIds,
  onSelectBlock,
  onOpenEditor,
  onBackground,
  onNudgeBlock,
}: ResumeCanvasProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [accent, setAccent] = useState(SELECTION_FALLBACK)
  const projected = projectResume(materialized, layout, page)
  const metrics = canvasMetrics(projected, zoom, PAGE_GAP)

  // The selection colour follows the interface accent. The canvas cannot read a
  // CSS custom property, so the value is read once per mount from the panel.
  useEffect(() => {
    const element = wrapper.current
    if (element === null) return
    const value = getComputedStyle(element).getPropertyValue('--accent').trim()
    if (value !== '') setAccent(value)
  }, [])

  const selectedBlockId = selection.kind === 'block' ? selection.blockId : null
  const selectedSectionId = selection.kind === 'section' ? selection.sectionId : null
  const agentSections = new Set<string>(highlightedSectionIds)
  const freeBlockIds = new Set(
    canvasBlocks.filter((block) => block.kind === 'text').map((block) => `free:${block.id}`),
  )

  const stageWidth = Math.max(metrics.contentWidth, 1)
  const stageHeight = Math.max(metrics.contentHeight, 1)

  return (
    <div
      className="resume-canvas"
      ref={wrapper}
      data-editor-open={editorBlockId === null ? undefined : ''}
      style={{ width: `${stageWidth.toString()}px`, height: `${stageHeight.toString()}px` }}
    >
      <Stage width={stageWidth} height={stageHeight}>
        <Layer>
          {projected.pages.map((projectedPage) => {
            const box = pageBoxOf(metrics, projectedPage.pageIndex)
            if (box === null) return null
            return (
              <Group key={projectedPage.pageIndex}>
                <Rect
                  x={box.left + 2}
                  y={box.top + 4}
                  width={box.width}
                  height={box.height}
                  fill="#000000"
                  opacity={0.12}
                  shadowColor="#0f172a"
                  shadowBlur={18}
                  shadowOpacity={0.22}
                  shadowOffsetY={6}
                  listening={false}
                />
                <Rect
                  x={box.left}
                  y={box.top}
                  width={box.width}
                  height={box.height}
                  fill={PAPER_FILL}
                  stroke="#d5dae1"
                  strokeWidth={1}
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) onBackground()
                  }}
                  onTap={(event) => {
                    if (event.target === event.currentTarget) onBackground()
                  }}
                />
                {projectedPage.blocks.map((block) => {
                  const sectionId = blockSectionIds.get(block.blockId)
                  return (
                    <BlockShape
                      key={block.blockId}
                      block={block}
                      pageTop={box.top}
                      zoom={zoom}
                      selected={
                        selectedBlockId === block.blockId ||
                        (selectedSectionId !== null && sectionId === selectedSectionId)
                      }
                      agentHighlighted={sectionId !== undefined && agentSections.has(sectionId)}
                      overflow={projected.overflows.has(block.blockId)}
                      accent={accent}
                      editable={editable}
                      editorOpen={editorBlockId === block.blockId}
                      onSelectBlock={onSelectBlock}
                      onOpenEditor={onOpenEditor}
                    />
                  )
                })}
                {page.showPageNumber ? (
                  <KonvaText
                    x={box.left}
                    y={box.top + box.height - 26 * zoom}
                    width={box.width}
                    align="center"
                    text={`第 ${(projectedPage.pageIndex + 1).toString()} 页 / 共 ${projected.pages.length.toString()} 页`}
                    fontSize={8.5 * zoom}
                    fontFamily={fontFamilyOf('Noto Sans SC')}
                    fill="#606770"
                    listening={false}
                  />
                ) : null}
              </Group>
            )
          })}
        </Layer>
      </Stage>

      {/* Keyboard path over the canvas: free text blocks are focusable, arrow
          keys nudge them by one point (Shift = ten). The buttons are invisible
          but take their block's exact box, so focus lands where the eye is. */}
      <div className="canvas-a11y-layer" aria-label="画布自由块">
        {canvasBlocks.map((block) => {
          if (!freeBlockIds.has(`free:${block.id}`)) return null
          const layoutId = `free:${block.id}` as LayoutBlockId
          const projectedBlock = projected.blocks.find((candidate) => candidate.blockId === layoutId)
          if (projectedBlock === undefined) return null
          const pageBox = pageBoxOf(metrics, projectedBlock.pageIndex)
          if (pageBox === null) return null
          const rect = blockScreenRect(projectedBlock, pageBox, zoom)
          return (
            <button
              key={block.id}
              type="button"
              className={
                selectedBlockId === layoutId
                  ? 'canvas-a11y-block canvas-a11y-block-selected'
                  : 'canvas-a11y-block'
              }
              style={{
                left: `${rect.left.toString()}px`,
                top: `${rect.top.toString()}px`,
                width: `${Math.max(rect.width, 8).toString()}px`,
                height: `${Math.max(rect.height, 8).toString()}px`,
              }}
              aria-label={`自由文本块：${block.text ?? ''}`}
              onFocus={() => onSelectBlock(layoutId)}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                if (!editable) return
                const step = event.shiftKey ? 10 : 1
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  onNudgeBlock(layoutId, -step, 0)
                }
                if (event.key === 'ArrowRight') {
                  event.preventDefault()
                  onNudgeBlock(layoutId, step, 0)
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  onNudgeBlock(layoutId, 0, -step)
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  onNudgeBlock(layoutId, 0, step)
                }
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
