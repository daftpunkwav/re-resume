/**
 * @file CanvasPageList
 * @description Stacks the projected pages on the Konva layer. It receives the
 * geometry the stage computed and passes each page its own slice of the
 * selection, overflow and editor state.
 */

import { Layer } from 'react-konva'

import type { LayoutBlockId, ResumeSectionId } from '../../domain/shared/branded-id'
import type { CanvasMetrics, ProjectedLayout } from './canvasProjection'
import { pageBoxOf } from './canvasProjection'
import { ResumePage } from './ResumePage'

export interface CanvasPageListProps {
  readonly projected: ProjectedLayout
  readonly metrics: CanvasMetrics
  readonly pageCount: number
  readonly zoom: number
  readonly accent: string
  readonly selectedBlockId: LayoutBlockId | null
  readonly selectedSectionId: ResumeSectionId | null
  readonly agentSections: ReadonlySet<string>
  readonly blockSectionIds: ReadonlyMap<LayoutBlockId, ResumeSectionId>
  readonly editorBlockId: LayoutBlockId | null
  readonly editable: boolean
  readonly showPageNumber: boolean
  readonly onSelectBlock: (blockId: LayoutBlockId) => void
  readonly onOpenEditor: (blockId: LayoutBlockId) => void
  readonly onBackground: () => void
}

export function CanvasPageList({
  projected,
  metrics,
  pageCount,
  zoom,
  accent,
  selectedBlockId,
  selectedSectionId,
  agentSections,
  blockSectionIds,
  editorBlockId,
  editable,
  showPageNumber,
  onSelectBlock,
  onOpenEditor,
  onBackground,
}: CanvasPageListProps) {
  return (
    <Layer>
      {projected.pages.map((projectedPage) => {
        const box = pageBoxOf(metrics, projectedPage.pageIndex)
        if (box === null) return null
        return (
          <ResumePage
            key={projectedPage.pageIndex}
            page={projectedPage}
            box={box}
            pageCount={pageCount}
            zoom={zoom}
            accent={accent}
            selectedBlockId={selectedBlockId}
            selectedSectionId={selectedSectionId}
            agentSections={agentSections}
            blockSectionIds={blockSectionIds}
            overflows={projected.overflows}
            editorBlockId={editorBlockId}
            editable={editable}
            showPageNumber={showPageNumber}
            onSelectBlock={onSelectBlock}
            onOpenEditor={onOpenEditor}
            onBackground={onBackground}
          />
        )
      })}
    </Layer>
  )
}
