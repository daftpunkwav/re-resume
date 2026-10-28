/**
 * @file CanvasViewport
 * @description The scrollable canvas region of the resume studio: it assembles
 * the toolbar, the scroll surface, the Konva canvas and the DOM overlays, and
 * starts the viewport's zoom/scroll/request hooks. All drawing, geometry and
 * gesture logic lives in the files this component calls.
 *
 * Constraints:
 * - The canvas is a reader of the store's layout; this component does not
 *   materialize, measure or paginate anything.
 */

import { Button } from '../app/components/Button'
import { EmptyState } from '../app/components/EmptyState'
import type { LayoutBlockId } from '../../domain/shared/branded-id'
import {
  canvasBlockForLayoutBlock,
  isEditableBlock,
  useResumeStore,
} from '../features/resume/resumeStore'
import { CanvasOverlays } from './CanvasOverlays'
import { CanvasToolbar } from './CanvasToolbar'
import { ResumeCanvas } from './ResumeCanvas'
import { CANVAS_PADDING } from './canvasViewportConfig'
import { useCanvasViewportControls } from './useCanvasViewportControls'
import { useCanvasViewportData } from './useCanvasViewportData'
import { useCanvasViewportRequests } from './useCanvasViewportRequests'

export function CanvasViewport() {
  const data = useCanvasViewportData()
  const selectBlock = useResumeStore((state) => state.selectBlock)
  const openEditor = useResumeStore((state) => state.openEditor)
  const clearSelection = useResumeStore((state) => state.clearSelection)
  const requestPage = useResumeStore((state) => state.requestPage)
  const setActiveTab = useResumeStore((state) => state.setActiveTab)
  const moveFreeBlock = useResumeStore((state) => state.moveFreeBlock)

  const { scrollRef, fitWidth, zoomIn, zoomOut, resetZoom, onScroll } = useCanvasViewportControls({
    page: data.page,
    metrics: data.metrics,
    selectedId: data.selectedId,
    currentPage: data.currentPage,
    fitRequest: data.fitRequest,
  })
  useCanvasViewportRequests({
    scrollRef,
    projected: data.projected,
    metrics: data.metrics,
    zoom: data.zoom,
    pageRequest: data.pageRequest,
    sectionRequest: data.sectionRequest,
  })

  if (
    data.resume === null ||
    data.materialized === null ||
    data.layout === null ||
    data.page === null ||
    data.projected === null ||
    data.metrics === null
  ) {
    return (
      <div className="resume-canvas-viewport resume-canvas-viewport-empty">
        <EmptyState
          compact
          icon="pen"
          title="正在准备画布"
          description="简历内容会在这里按页面排版显示。"
        />
      </div>
    )
  }

  if (data.pageCount === 0) {
    return (
      <div className="resume-canvas-viewport resume-canvas-viewport-empty">
        <EmptyState
          compact
          icon="pen"
          title="这份简历还没有内容"
          description="从信息库挑选条目、加入章节后，页面会出现在这里。"
          action={
            <Button variant="secondary" size="small" onClick={() => setActiveTab('composition')}>
              去组合内容
            </Button>
          }
        />
      </div>
    )
  }

  const canEditBlock = (blockId: LayoutBlockId): boolean =>
    isEditableBlock(data.resume, data.materialized, blockId)

  const nudgeBlock = (blockId: LayoutBlockId, dx: number, dy: number): void => {
    const canvasBlock = canvasBlockForLayoutBlock(data.resume, blockId)
    if (canvasBlock === null) return
    const block = data.resume?.document.canvas.freeBlocks.find(
      (candidate) => candidate.id === canvasBlock.id,
    )
    if (block === undefined) return
    void moveFreeBlock(block.id, block.x + dx, block.y + dy)
  }

  return (
    <div className="resume-canvas-viewport">
      <CanvasToolbar
        zoom={data.zoom}
        currentPage={data.currentPage}
        pageCount={data.pageCount}
        overflowEntries={data.overflowEntries}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
        onFit={fitWidth}
        onRequestPage={requestPage}
        onSelectBlock={selectBlock}
      />
      <div
        className="resume-canvas-scroll"
        ref={scrollRef}
        onScroll={onScroll}
      >
        <div
          className="resume-canvas-content"
          style={{
            width: `${(data.metrics.contentWidth + CANVAS_PADDING * 2).toString()}px`,
            height: `${(data.metrics.contentHeight + CANVAS_PADDING * 2).toString()}px`,
            padding: `${CANVAS_PADDING.toString()}px`,
          }}
        >
          <div
            className="resume-canvas-stage"
            style={{
              position: 'relative',
              width: `${data.metrics.contentWidth.toString()}px`,
              height: `${data.metrics.contentHeight.toString()}px`,
            }}
          >
            <ResumeCanvas
              materialized={data.materialized}
              layout={data.layout}
              page={data.page}
              zoom={data.zoom}
              selection={data.selection}
              highlightedSectionIds={data.highlightedSectionIds}
              editorBlockId={data.editorTarget?.layoutBlockId ?? null}
              editable={data.editable}
              canvasBlocks={data.canvasBlocks}
              blockSectionIds={data.blockSectionIds}
              onSelectBlock={(blockId) => {
                if (!canEditBlock(blockId) && blockId.startsWith('free:')) return
                selectBlock(blockId)
              }}
              onOpenEditor={openEditor}
              onBackground={clearSelection}
              onNudgeBlock={nudgeBlock}
            />
            <CanvasOverlays
              metrics={data.metrics}
              zoom={data.zoom}
              materialized={data.materialized}
              overflowEntries={data.overflowEntries}
              editorTarget={data.editorTarget}
              editor={data.editor}
              onRequestPage={requestPage}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

