/**
 * @file useCanvasViewportControls
 * @description Zoom, fit and scroll behaviour of the canvas viewport. The hooks
 * own the scroll element and the gestures; the component only lays out the
 * toolbar and the scroll surface.
 *
 * Behaviour contract:
 * - The first paint of a page fits the panel, and a manual zoom opts out until
 *   the resume changes.
 * - The dock resize observer keeps a fitted page fitted; a manual zoom wins.
 * - Ctrl/Cmd+wheel zooms around the pointer through a non-passive listener,
 *   because React's synthetic wheel listener cannot prevent the browser zoom.
 * - Scrolling reports the nearest page back to the store.
 */

import { useCallback, useEffect, useRef } from 'react'

import type { PageSetup } from '../../domain/resume/PageSetup'
import { pageWidth } from '../../domain/resume/PageSetup'
import type { ResumeId } from '../../domain/shared/branded-id'
import { useResumeStore } from '../features/resume/resumeStore'
import { pageAtOffset, type CanvasMetrics } from './canvasProjection'
import { CANVAS_PADDING, ZOOM_STEP } from './canvasViewportConfig'

export interface CanvasViewportControlsArgs {
  readonly page: PageSetup | null
  readonly metrics: CanvasMetrics | null
  readonly selectedId: ResumeId | null
  readonly currentPage: number
  readonly fitRequest: number
}

export interface CanvasViewportControls {
  readonly scrollRef: React.RefObject<HTMLDivElement | null>
  readonly fitWidth: () => void
  readonly zoomIn: () => void
  readonly zoomOut: () => void
  readonly resetZoom: () => void
  readonly onScroll: () => void
}

export function useCanvasViewportControls({
  page,
  metrics,
  selectedId,
  currentPage,
  fitRequest,
}: CanvasViewportControlsArgs): CanvasViewportControls {
  const scrollRef = useRef<HTMLDivElement>(null)
  const manualZoom = useRef(false)
  const setZoom = useResumeStore((state) => state.setZoom)
  const zoomBy = useResumeStore((state) => state.zoomBy)
  const setCurrentPage = useResumeStore((state) => state.setCurrentPage)

  const fitWidth = useCallback(() => {
    const element = scrollRef.current
    if (element === null || page === null) return
    const available = element.clientWidth - CANVAS_PADDING * 2
    if (available <= 0) return
    manualZoom.current = false
    setZoom(available / pageWidth(page))
  }, [page, setZoom])
  // The observer and the page-change effect need the latest fit without being
  // rebuilt by a document write: a rebuilt effect would reset a manual zoom.
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
  const canvasReady = page !== null
  useEffect(() => {
    if (!canvasReady) return
    const element = scrollRef.current
    if (element === null) return
    const observer = new ResizeObserver(() => {
      if (!manualZoom.current) fitWidthRef.current()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [canvasReady])

  useEffect(() => {
    if (fitRequest === 0) return
    const element = scrollRef.current
    if (element === null || page === null) return
    const available = element.clientWidth - CANVAS_PADDING * 2
    if (available > 0) setZoom(available / pageWidth(page))
  }, [fitRequest, page, setZoom])

  // Ctrl/Cmd+wheel zooms around the pointer. The listener is installed natively
  // because React's synthetic wheel listener is passive, and a passive listener
  // cannot stop the page from zooming instead of the canvas.
  useEffect(() => {
    if (!canvasReady) return
    const element = scrollRef.current
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

  const onScroll = useCallback(() => {
    const element = scrollRef.current
    if (element === null || metrics === null) return
    const next = pageAtOffset(metrics, element.scrollTop)
    if (next !== currentPage) setCurrentPage(next)
  }, [metrics, currentPage, setCurrentPage])

  const zoomIn = useCallback(() => {
    manualZoom.current = true
    zoomBy(ZOOM_STEP)
  }, [zoomBy])

  const zoomOut = useCallback(() => {
    manualZoom.current = true
    zoomBy(-ZOOM_STEP)
  }, [zoomBy])

  const resetZoom = useCallback(() => {
    manualZoom.current = true
    setZoom(1)
  }, [setZoom])

  return { scrollRef, fitWidth, zoomIn, zoomOut, resetZoom, onScroll }
}
