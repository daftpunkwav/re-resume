/**
 * @file ResumeCanvas
 * @description Draws the laid-out resume with Konva. It never measures, wraps
 * or paginates: every coordinate, line break and page comes from the projected
 * `LayoutOutput`, which is the same source the PDF exporter will read. One
 * canvas unit is one CSS pixel; the stage transform is the zoom.
 *
 * Responsibilities:
 * - One stage whose layer stacks the paper sheets
 * - The selected/agent accent, read once per mount from the interface
 * - The keyboard layer over free canvas blocks
 *
 * Constraints:
 * - No document edits: clicks call the callbacks; the store owns the writes.
 * - The page and block drawing live in their own components; this file only
 *   assembles them, so neither grows back into a drawing routine.
 */

import { useRef } from 'react'
import { Stage } from 'react-konva'

import type { CanvasBlock } from '../../domain/resume/CanvasLayout'
import type { LayoutOutput } from '../../domain/resume/PageLayout'
import type { PageSetup } from '../../domain/resume/PageSetup'
import type { MaterializedDocument } from '../../domain/resume/ResumeSnapshot'
import type { LayoutBlockId, ResumeSectionId } from '../../domain/shared/branded-id'
import type { StudioSelection } from '../features/resume/resumeStore'
import { CanvasPageList } from './CanvasPageList'
import { FreeBlockKeyboardLayer } from './FreeBlockKeyboardLayer'
import { canvasMetrics, projectResume } from './canvasProjection'
import { PAGE_GAP } from './canvasStyle'
import { useCanvasAccent } from './useCanvasAccent'

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
  const accent = useCanvasAccent()
  const projected = projectResume(materialized, layout, page)
  const metrics = canvasMetrics(projected, zoom, PAGE_GAP)

  const selectedBlockId = selection.kind === 'block' ? selection.blockId : null
  const selectedSectionId = selection.kind === 'section' ? selection.sectionId : null
  const agentSections = new Set<string>(highlightedSectionIds)
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
        <CanvasPageList
          projected={projected}
          metrics={metrics}
          pageCount={projected.pages.length}
          zoom={zoom}
          accent={accent}
          selectedBlockId={selectedBlockId}
          selectedSectionId={selectedSectionId}
          agentSections={agentSections}
          blockSectionIds={blockSectionIds}
          editorBlockId={editorBlockId}
          editable={editable}
          showPageNumber={page.showPageNumber}
          onSelectBlock={onSelectBlock}
          onOpenEditor={onOpenEditor}
          onBackground={onBackground}
        />
      </Stage>
      <FreeBlockKeyboardLayer
        projected={projected}
        metrics={metrics}
        zoom={zoom}
        canvasBlocks={canvasBlocks}
        selectedBlockId={selectedBlockId}
        editable={editable}
        onSelectBlock={onSelectBlock}
        onNudgeBlock={onNudgeBlock}
      />
    </div>
  )
}
