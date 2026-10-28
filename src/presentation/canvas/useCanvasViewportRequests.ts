/**
 * @file useCanvasViewportRequests
 * @description Effects that answer the store's navigation requests: reveal a
 * page, or scroll a chapter's heading into view and select it.
 *
 * The requests carry a nonce, so the same request value can be issued twice and
 * still run both times.
 */

import { useEffect } from 'react'

import type { LayoutBlockId } from '../../domain/shared/branded-id'
import { useResumeStore } from '../features/resume/resumeStore'
import { pageBoxOf, type CanvasMetrics, type ProjectedLayout } from './canvasProjection'
import { CANVAS_PADDING } from './canvasViewportConfig'

export interface CanvasViewportRequestsArgs {
  readonly scrollRef: React.RefObject<HTMLDivElement | null>
  readonly projected: ProjectedLayout | null
  readonly metrics: CanvasMetrics | null
  readonly zoom: number
  readonly pageRequest: ReturnType<typeof useResumeStore.getState>['pageRequest']
  readonly sectionRequest: ReturnType<typeof useResumeStore.getState>['sectionRequest']
}

export function useCanvasViewportRequests({
  scrollRef,
  projected,
  metrics,
  zoom,
  pageRequest,
  sectionRequest,
}: CanvasViewportRequestsArgs): void {
  const selectBlock = useResumeStore((state) => state.selectBlock)

  useEffect(() => {
    const box =
      pageRequest === null || metrics === null
        ? null
        : pageBoxOf(metrics, pageRequest.pageIndex)
    const element = scrollRef.current
    if (box === null || element === null) return
    element.scrollTo({ top: Math.max(0, box.top - CANVAS_PADDING), behavior: 'smooth' })
  }, [pageRequest, metrics, scrollRef])

  useEffect(() => {
    if (sectionRequest === null || projected === null || metrics === null) return
    const blockId = `section:${sectionRequest.sectionId}` as LayoutBlockId
    const block = projected.blocks.find((candidate) => candidate.blockId === blockId)
    const element = scrollRef.current
    if (block === undefined || element === null) return
    const box = pageBoxOf(metrics, block.pageIndex)
    if (box === null) return
    selectBlock(block.blockId)
    element.scrollTo({
      top: Math.max(0, box.top + block.y * zoom - CANVAS_PADDING),
      behavior: 'smooth',
    })
  }, [sectionRequest, projected, metrics, zoom, selectBlock, scrollRef])
}
