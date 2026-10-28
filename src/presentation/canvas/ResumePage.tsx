/**
 * @file ResumePage
 * @description One paper sheet on the canvas: the paper parts, the blocks laid
 * on it and the page number. The parts and the block list are their own
 * components, so this file only wires one page's state together.
 */

import { Group } from 'react-konva'

import type { OverflowReason } from '../../domain/resume/PageLayout'
import type { LayoutBlockId, ResumeSectionId } from '../../domain/shared/branded-id'
import type { PageScreenBox, ProjectedPage } from './canvasProjection'
import { ResumeBlockShape } from './ResumeBlockShape'
import { PageNumberText, PaperShadow, PaperSurface } from './ResumePageParts'

interface PageBlocksProps {
  readonly page: ProjectedPage
  readonly box: PageScreenBox
  readonly zoom: number
  readonly accent: string
  readonly selectedBlockId: LayoutBlockId | null
  readonly selectedSectionId: ResumeSectionId | null
  readonly agentSections: ReadonlySet<string>
  readonly blockSectionIds: ReadonlyMap<LayoutBlockId, ResumeSectionId>
  readonly overflows: ReadonlyMap<LayoutBlockId, OverflowReason>
  readonly editorBlockId: LayoutBlockId | null
  readonly editable: boolean
  readonly onSelectBlock: (blockId: LayoutBlockId) => void
  readonly onOpenEditor: (blockId: LayoutBlockId) => void
}

function PageBlocks({
  page,
  box,
  zoom,
  accent,
  selectedBlockId,
  selectedSectionId,
  agentSections,
  blockSectionIds,
  overflows,
  editorBlockId,
  editable,
  onSelectBlock,
  onOpenEditor,
}: PageBlocksProps) {
  return (
    <>
      {page.blocks.map((block) => {
        const sectionId = blockSectionIds.get(block.blockId)
        return (
          <ResumeBlockShape
            key={block.blockId}
            block={block}
            pageTop={box.top}
            zoom={zoom}
            selected={
              selectedBlockId === block.blockId ||
              (selectedSectionId !== null && sectionId === selectedSectionId)
            }
            agentHighlighted={sectionId !== undefined && agentSections.has(sectionId)}
            overflow={overflows.has(block.blockId)}
            accent={accent}
            editable={editable}
            editorOpen={editorBlockId === block.blockId}
            onSelectBlock={onSelectBlock}
            onOpenEditor={onOpenEditor}
          />
        )
      })}
    </>
  )
}

export interface ResumePageProps {
  readonly page: ProjectedPage
  readonly box: PageScreenBox
  readonly pageCount: number
  readonly zoom: number
  readonly accent: string
  readonly selectedBlockId: LayoutBlockId | null
  readonly selectedSectionId: ResumeSectionId | null
  readonly agentSections: ReadonlySet<string>
  readonly blockSectionIds: ReadonlyMap<LayoutBlockId, ResumeSectionId>
  readonly overflows: ReadonlyMap<LayoutBlockId, OverflowReason>
  readonly editorBlockId: LayoutBlockId | null
  readonly editable: boolean
  readonly showPageNumber: boolean
  readonly onSelectBlock: (blockId: LayoutBlockId) => void
  readonly onOpenEditor: (blockId: LayoutBlockId) => void
  readonly onBackground: () => void
}

export function ResumePage({
  page,
  box,
  pageCount,
  zoom,
  accent,
  selectedBlockId,
  selectedSectionId,
  agentSections,
  blockSectionIds,
  overflows,
  editorBlockId,
  editable,
  showPageNumber,
  onSelectBlock,
  onOpenEditor,
  onBackground,
}: ResumePageProps) {
  return (
    <Group>
      <PaperShadow box={box} />
      <PaperSurface box={box} onBackground={onBackground} />
      <PageBlocks
        page={page}
        box={box}
        zoom={zoom}
        accent={accent}
        selectedBlockId={selectedBlockId}
        selectedSectionId={selectedSectionId}
        agentSections={agentSections}
        blockSectionIds={blockSectionIds}
        overflows={overflows}
        editorBlockId={editorBlockId}
        editable={editable}
        onSelectBlock={onSelectBlock}
        onOpenEditor={onOpenEditor}
      />
      {showPageNumber ? (
        <PageNumberText box={box} pageIndex={page.pageIndex} pageCount={pageCount} zoom={zoom} />
      ) : null}
    </Group>
  )
}
