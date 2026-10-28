/**
 * @file CanvasViewport
 * @description The scrollable canvas region of the resume studio: zoom and fit,
 * page navigation, the current-page indicator, overflow markers, and the
 * in-place editor drawn over the block it edits.
 *
 * Responsibilities:
 * - Own the scroll container, its zoom gestures and its page tracking
 * - Satisfy the store's view requests (`fitWidth`, page, section) so another
 *   region can bring the canvas to a place without reaching into the DOM
 * - Place the inline editor over the projected block and route its value to
 *   the store's editor action
 *
 * Constraints:
 * - The canvas is a reader of the store's layout; this component does not
 *   materialize, measure or paginate anything.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CanvasBlock } from '../../domain/resume/CanvasLayout'
import { pageWidth } from '../../domain/resume/PageSetup'
import type { TextStyle } from '../../domain/resume/TextStyle'
import type { LayoutBlockId, ResumeSectionId } from '../../domain/shared/branded-id'
import { Button } from '../app/components/Button'
import { EmptyState } from '../app/components/EmptyState'
import { Popover } from '../app/components/Popover'
import { useResumeStore } from '../features/resume/resumeStore'
import {
  canvasBlockForLayoutBlock,
  isEditableBlock,
  saveEditorText,
  sectionIdForBlock,
} from '../features/resume/resumeStore'
import { overflowReasonText } from '../features/resume/resumeFormat'
import { ResumeCanvas } from './ResumeCanvas'
import { TextEditorOverlay } from './TextEditorOverlay'
import {
  blockScreenRect,
  canvasMetrics,
  pageAtOffset,
  pageBoxOf,
  projectResume,
  type ProjectedBlock,
} from './canvasProjection'

/** Horizontal breathing room around the pages, in CSS pixels. */
const CANVAS_PADDING = 16
const PAGE_GAP = 24
const ZOOM_STEP = 0.1

function styleForFreeBlock(block: CanvasBlock | null, fallback: TextStyle | null): TextStyle | null {
  return block?.textStyle ?? fallback
}

export function CanvasViewport() {
  const scroll = useRef<HTMLDivElement>(null)
  const manualZoom = useRef(false)
  const [overflowOpen, setOverflowOpen] = useState(false)

  const resume = useResumeStore((state) => state.resume)
  const materialized = useResumeStore((state) => state.materialized)
  const layout = useResumeStore((state) => state.layout)
  const zoom = useResumeStore((state) => state.zoom)
  const selection = useResumeStore((state) => state.selection)
  const editorTarget = useResumeStore((state) => state.editorTarget)
  const styles = useResumeStore((state) => state.styles)
  const currentPage = useResumeStore((state) => state.currentPage)
  const fitRequest = useResumeStore((state) => state.fitRequest)
  const pageRequest = useResumeStore((state) => state.pageRequest)
  const sectionRequest = useResumeStore((state) => state.sectionRequest)
  const highlightedSectionIds = useResumeStore((state) => state.highlightedSectionIds)
  const selectedId = useResumeStore((state) => state.selectedId)

  const setZoom = useResumeStore((state) => state.setZoom)
  const zoomBy = useResumeStore((state) => state.zoomBy)
  const setCurrentPage = useResumeStore((state) => state.setCurrentPage)
  const requestPage = useResumeStore((state) => state.requestPage)
  const selectBlock = useResumeStore((state) => state.selectBlock)
  const openEditor = useResumeStore((state) => state.openEditor)
  const closeEditor = useResumeStore((state) => state.closeEditor)
  const clearSelection = useResumeStore((state) => state.clearSelection)
  const setActiveTab = useResumeStore((state) => state.setActiveTab)

  const page = resume?.document.pageSetup ?? null
  const canvasReady = page !== null
  const projected = useMemo(
    () => (materialized === null || layout === null || page === null ? null : projectResume(materialized, layout, page)),
    [materialized, layout, page],
  )
  const metrics = useMemo(
    () => (projected === null ? null : canvasMetrics(projected, zoom, PAGE_GAP)),
    [projected, zoom],
  )
  const pageCount = layout?.pages.length ?? 0
  const editable = resume !== null && resume.status === 'draft'
  const canvasBlocks = resume?.document.canvas.freeBlocks ?? []
  const blockSectionIds = useMemo(() => {
    const map = new Map<LayoutBlockId, ResumeSectionId>()
    if (resume === null || layout === null) return map
    for (const block of layout.blocks) {
      const sectionId = sectionIdForBlock(resume, block.blockId)
      if (sectionId !== null) map.set(block.blockId, sectionId)
    }
    return map
  }, [resume, layout])

  const fitWidth = useCallback(() => {
    const element = scroll.current
    if (element === null || page === null) return
    const available = element.clientWidth - CANVAS_PADDING * 2
    if (available <= 0) return
    manualZoom.current = false
    setZoom(available / pageWidth(page))
  }, [page, setZoom])
  // The observer and the page-change hook need the latest fit, but must not be
  // torn down and rebuilt by a document write: a rebuilt effect used to reset
  // the manual zoom after every revision.
  const fitWidthRef = useRef(fitWidth)
  useEffect(() => {
    fitWidthRef.current = fitWidth
  }, [fitWidth])

  // The first paint of a page fits the panel: a 400px dock cannot show an A4
  // sheet at 100%, and opening on a horizontally scrolled page hides the
  // document's left edge. A manual zoom opts out until the resume changes.
  useEffect(() => {
    manualZoom.current = false
    const frame = requestAnimationFrame(() => fitWidthRef.current())
    return () => cancelAnimationFrame(frame)
  }, [selectedId])

  // The dock is resizable, so the observer re-applies the fit while the panel is
  // being dragged wider or narrower; a manual zoom wins from then on.
  useEffect(() => {
    if (!canvasReady) return
    const element = scroll.current
    if (element === null) return
    const observer = new ResizeObserver(() => {
      if (!manualZoom.current) fitWidthRef.current()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [canvasReady])

  useEffect(() => {
    if (fitRequest === 0) return
    const element = scroll.current
    if (element === null || page === null) return
    const available = element.clientWidth - CANVAS_PADDING * 2
    if (available > 0) setZoom(available / pageWidth(page))
  }, [fitRequest, page, setZoom])

  useEffect(() => {
    const box = pageRequest === null || metrics === null ? null : pageBoxOf(metrics, pageRequest.pageIndex)
    const element = scroll.current
    if (box === null || element === null) return
    element.scrollTo({ top: Math.max(0, box.top - CANVAS_PADDING), behavior: 'smooth' })
  }, [pageRequest, metrics])

  useEffect(() => {
    if (sectionRequest === null || projected === null || metrics === null) return
    const blockId = `section:${sectionRequest.sectionId}` as LayoutBlockId
    const block = projected.blocks.find((candidate) => candidate.blockId === blockId)
    const element = scroll.current
    if (block === undefined || element === null) return
    const box = pageBoxOf(metrics, block.pageIndex)
    if (box === null) return
    selectBlock(block.blockId)
    element.scrollTo({ top: Math.max(0, box.top + block.y * zoom - CANVAS_PADDING), behavior: 'smooth' })
  }, [sectionRequest, projected, metrics, zoom, selectBlock])

  const onScroll = useCallback(() => {
    const element = scroll.current
    if (element === null || metrics === null) return
    const next = pageAtOffset(metrics, element.scrollTop)
    if (next !== currentPage) setCurrentPage(next)
  }, [metrics, currentPage, setCurrentPage])

  // Ctrl/Cmd+wheel zooms around the pointer. The listener is installed
  // natively because React's synthetic wheel listener is passive, and a passive
  // listener cannot stop the page from zooming instead of the canvas.
  useEffect(() => {
    if (!canvasReady) return
    const element = scroll.current
    if (element === null) return
    const handler = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      manualZoom.current = true
      const previous = useResumeStore.getState().zoom
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
      const before = element.scrollTop
      const pointerY = event.clientY - element.getBoundingClientRect().top
      useResumeStore.getState().setZoom(previous * factor)
      const applied = useResumeStore.getState().zoom
      if (applied === previous) return
      element.scrollTop = Math.max(0, (before + pointerY) * (applied / previous) - pointerY)
    }
    element.addEventListener('wheel', handler, { passive: false })
    return () => element.removeEventListener('wheel', handler)
  }, [canvasReady])

  const editorBlock: ProjectedBlock | null =
    editorTarget === null || projected === null
      ? null
      : (projected.blocks.find((block) => block.blockId === editorTarget.layoutBlockId) ?? null)
  const editorPageBox = editorBlock === null || metrics === null ? null : pageBoxOf(metrics, editorBlock.pageIndex)
  const editorRect =
    editorBlock === null || editorPageBox === null ? null : blockScreenRect(editorBlock, editorPageBox, zoom)
  const editorStyle: TextStyle | null =
    editorTarget === null
      ? null
      : editorTarget.kind === 'freeText'
        ? styleForFreeBlock(
            canvasBlockForLayoutBlock(resume, editorTarget.layoutBlockId),
            styles?.freeText ?? null,
          )
        : (styles?.entryBody ?? null)

  const overflowEntries = (layout?.overflows ?? []).map((overflow) => ({
    ...overflow,
    block: projected?.blocks.find((block) => block.blockId === overflow.blockId) ?? null,
  }))

  const nudgeBlock = (blockId: LayoutBlockId, dx: number, dy: number): void => {
    const canvasBlock = canvasBlockForLayoutBlock(resume, blockId)
    if (canvasBlock === null) return
    const block = resume?.document.canvas.freeBlocks.find((candidate) => candidate.id === canvasBlock.id)
    if (block === undefined) return
    void useResumeStore.getState().moveFreeBlock(block.id, block.x + dx, block.y + dy)
  }

  if (resume === null || materialized === null || layout === null || page === null || projected === null || metrics === null) {
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

  if (pageCount === 0) {
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
    isEditableBlock(resume, materialized, blockId)

  return (
    <div className="resume-canvas-viewport">
      <div className="canvas-toolbar" role="toolbar" aria-label="画布工具栏">
        <div className="canvas-toolbar-group">
          <button
            type="button"
            className="canvas-tool"
            aria-label="缩小画布"
            onClick={() => {
              manualZoom.current = true
              zoomBy(-ZOOM_STEP)
            }}
          >
            −
          </button>
          <button
            type="button"
            className="canvas-zoom-label"
            aria-label={`当前缩放 ${Math.round(zoom * 100).toString()}%，恢复 100%`}
            onClick={() => {
              manualZoom.current = true
              setZoom(1)
            }}
          >
            {Math.round(zoom * 100).toString()}%
          </button>
          <button
            type="button"
            className="canvas-tool"
            aria-label="放大画布"
            onClick={() => {
              manualZoom.current = true
              zoomBy(ZOOM_STEP)
            }}
          >
            +
          </button>
          <button
            type="button"
            className="canvas-tool canvas-tool-wide"
            aria-label="适应面板宽度"
            onClick={fitWidth}
          >
            适应
          </button>
        </div>
        <div className="canvas-toolbar-group canvas-page-controls">
          <button
            type="button"
            className="canvas-tool"
            aria-label="上一页"
            disabled={currentPage <= 0}
            onClick={() => requestPage(currentPage - 1)}
          >
            ‹
          </button>
          <span className="canvas-page-label" aria-live="polite">
            {(currentPage + 1).toString()} / {pageCount.toString()}
          </span>
          <button
            type="button"
            className="canvas-tool"
            aria-label="下一页"
            disabled={currentPage >= pageCount - 1}
            onClick={() => requestPage(currentPage + 1)}
          >
            ›
          </button>
        </div>
        {overflowEntries.length === 0 ? (
          <span className="canvas-status-ok">无溢出</span>
        ) : (
          <div className="popover-anchor">
            <button
              type="button"
              className="canvas-overflow-count"
              aria-haspopup="dialog"
              aria-expanded={overflowOpen}
              onClick={() => setOverflowOpen((open) => !open)}
            >
              {overflowEntries.length.toString()} 处溢出
            </button>
            <Popover
              open={overflowOpen}
              label="排版溢出"
              align="end"
              onClose={() => setOverflowOpen(false)}
            >
              <p className="popover-title">建议先处理的排版问题</p>
              <ul className="canvas-overflow-list">
                {overflowEntries.map((entry) => (
                  <li key={`${entry.blockId}-${entry.reason}`}>
                    <button
                      type="button"
                      className="canvas-overflow-item"
                      onClick={() => {
                        setOverflowOpen(false)
                        requestPage(entry.pageIndex)
                        selectBlock(entry.blockId)
                      }}
                    >
                      <span>{overflowReasonText(entry.reason)}</span>
                      <span className="canvas-overflow-page">第 {(entry.pageIndex + 1).toString()} 页</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Popover>
          </div>
        )}
      </div>

      <div className="resume-canvas-scroll" ref={scroll} onScroll={onScroll}>
        <div
          className="resume-canvas-content"
          style={{
            width: `${(metrics.contentWidth + CANVAS_PADDING * 2).toString()}px`,
            height: `${(metrics.contentHeight + CANVAS_PADDING * 2).toString()}px`,
            padding: `${CANVAS_PADDING.toString()}px`,
          }}
        >
          <div
            className="resume-canvas-stage"
            style={{
              position: 'relative',
              width: `${metrics.contentWidth.toString()}px`,
              height: `${metrics.contentHeight.toString()}px`,
            }}
          >
            <ResumeCanvas
              materialized={materialized}
              layout={layout}
              page={page}
              zoom={zoom}
              selection={selection}
              highlightedSectionIds={highlightedSectionIds}
              editorBlockId={editorTarget?.layoutBlockId ?? null}
              editable={editable}
              canvasBlocks={canvasBlocks}
              blockSectionIds={blockSectionIds}
              onSelectBlock={(blockId) => {
                if (!canEditBlock(blockId) && blockId.startsWith('free:')) return
                selectBlock(blockId)
              }}
              onOpenEditor={openEditor}
              onBackground={clearSelection}
              onNudgeBlock={nudgeBlock}
            />
            {overflowEntries.map((entry) => {
              if (entry.block === null) return null
              const box = pageBoxOf(metrics, entry.block.pageIndex)
              if (box === null) return null
              const rect = blockScreenRect(entry.block, box, zoom)
              return (
                <button
                  key={`badge-${entry.blockId}-${entry.reason}`}
                  type="button"
                  className="canvas-overflow-badge"
                  style={{
                    left: `${(rect.left + rect.width - 10).toString()}px`,
                    top: `${(rect.top - 6).toString()}px`,
                  }}
                  aria-label={`${overflowReasonText(entry.reason)}，定位`}
                  onClick={() => requestPage(entry.pageIndex)}
                >
                  !
                </button>
              )
            })}
            {materialized.blocks.every((block) => block.role === 'sectionHeader') ? (
              <div className="canvas-empty-hint" role="status">
                <p className="canvas-empty-title">这份简历还没有条目内容</p>
                <p className="canvas-empty-copy">
                  章节已经排好，选择条目后正文会出现在这里。
                </p>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setActiveTab('composition')}
                >
                  去选择条目
                </Button>
              </div>
            ) : null}
            {editorTarget !== null && editorRect !== null && editorStyle !== null ? (
              <TextEditorOverlay
                key={editorTarget.layoutBlockId}
                left={editorRect.left}
                top={editorRect.top}
                width={editorRect.width}
                height={editorRect.height}
                zoom={zoom}
                text={editorTarget.text}
                style={editorStyle}
                label={
                  editorTarget.kind === 'freeText'
                    ? '编辑自由文本'
                    : editorTarget.kind === 'summary'
                      ? '编辑个人简介'
                      : '编辑条目改写'
                }
                emptyError={editorTarget.kind === 'freeText' ? '自由文本不能为空。' : null}
                placeholder={
                  editorTarget.kind === 'summary'
                    ? '写一段面向这份岗位的个人简介…'
                    : editorTarget.kind === 'freeText'
                      ? '输入画布文字；内容不能为空'
                      : editorTarget.layoutBlockId === 'header'
                        ? '写一段自我介绍，显示在姓名下方（可选）'
                        : '改写这个条目的正文…'
                }
                multiline={editorTarget.kind !== 'freeText' || (editorRect.height > 24 * zoom)}
                onCommit={async (text) => {
                  const accepted = await saveEditorText(text)
                  if (accepted) closeEditor()
                  return accepted
                }}
                onCancel={closeEditor}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export type { ProjectedBlock }
