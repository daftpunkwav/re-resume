/**
 * @file CanvasToolbar
 * @description The canvas toolbar: zoom controls, page navigation and the
 * overflow summary. It is presentational; the viewport owns the gestures and
 * the store calls the buttons trigger.
 */

import { useState } from 'react'

import { Popover } from '../app/components/Popover'
import { overflowReasonText } from '../features/resume/resumeFormat'
import type { CanvasOverflowEntry } from './useCanvasViewportData'

export interface CanvasToolbarProps {
  readonly zoom: number
  readonly currentPage: number
  readonly pageCount: number
  readonly overflowEntries: readonly CanvasOverflowEntry[]
  readonly onZoomIn: () => void
  readonly onZoomOut: () => void
  readonly onResetZoom: () => void
  readonly onFit: () => void
  readonly onRequestPage: (pageIndex: number) => void
  readonly onSelectBlock: (blockId: CanvasOverflowEntry['blockId']) => void
}

export function CanvasToolbar({
  zoom,
  currentPage,
  pageCount,
  overflowEntries,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFit,
  onRequestPage,
  onSelectBlock,
}: CanvasToolbarProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)

  return (
    <div className="canvas-toolbar" role="toolbar" aria-label="画布工具栏">
      <div className="canvas-toolbar-group">
        <button type="button" className="canvas-tool" aria-label="缩小画布" onClick={onZoomOut}>
          −
        </button>
        <button
          type="button"
          className="canvas-zoom-label"
          aria-label={`当前缩放 ${Math.round(zoom * 100).toString()}%，恢复 100%`}
          onClick={onResetZoom}
        >
          {Math.round(zoom * 100).toString()}%
        </button>
        <button type="button" className="canvas-tool" aria-label="放大画布" onClick={onZoomIn}>
          +
        </button>
        <button
          type="button"
          className="canvas-tool canvas-tool-wide"
          aria-label="适应面板宽度"
          onClick={onFit}
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
          onClick={() => onRequestPage(currentPage - 1)}
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
          onClick={() => onRequestPage(currentPage + 1)}
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
                      onRequestPage(entry.pageIndex)
                      onSelectBlock(entry.blockId)
                    }}
                  >
                    <span>{overflowReasonText(entry.reason)}</span>
                    <span className="canvas-overflow-page">
                      第 {(entry.pageIndex + 1).toString()} 页
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Popover>
        </div>
      )}
    </div>
  )
}
