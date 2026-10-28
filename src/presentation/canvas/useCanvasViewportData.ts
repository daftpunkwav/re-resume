/**
 * @file useCanvasViewportData
 * @description The projection the viewport renders plus the derived geometry its
 * toolbar and overlays need. The hook only reads from the store; the pure
 * helpers below it do the deriving, so no single function carries all the null
 * checks of a loading document.
 */

import { useMemo } from 'react'

import type { CanvasBlock } from '../../domain/resume/CanvasLayout'
import type { LayoutOutput, OverflowReason } from '../../domain/resume/PageLayout'
import type { PageSetup } from '../../domain/resume/PageSetup'
import type { Resume } from '../../domain/resume/Resume'
import type { MaterializedDocument } from '../../domain/resume/ResumeSnapshot'
import type { TextStyle } from '../../domain/resume/TextStyle'
import type { LayoutBlockId, ResumeSectionId } from '../../domain/shared/branded-id'
import { useResumeStore } from '../features/resume/resumeStore'
import {
  blockScreenRect,
  canvasMetrics,
  pageBoxOf,
  projectResume,
  type CanvasMetrics,
  type ProjectedBlock,
  type ProjectedLayout,
} from './canvasProjection'
import {
  canvasBlockForLayoutBlock,
  sectionIdForBlock,
} from '../features/resume/resumeStore'
import { PAGE_GAP } from './canvasViewportConfig'

type StudioState = ReturnType<typeof useResumeStore.getState>
type StudioResume = StudioState['resume']
type StudioMaterialized = StudioState['materialized']
type StudioSelection = StudioState['selection']
type StudioEditorTarget = StudioState['editorTarget']
type StudioStyles = StudioState['styles']

/** One overflow marker, with the projected block it points at when it has one. */
export interface CanvasOverflowEntry {
  readonly blockId: LayoutBlockId
  readonly reason: OverflowReason
  readonly pageIndex: number
  readonly block: ProjectedBlock | null
}

export interface EditorGeometry {
  readonly block: ProjectedBlock | null
  readonly rect: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  } | null
  readonly style: TextStyle | null
}

export interface CanvasViewportData {
  readonly resume: StudioResume
  readonly materialized: StudioMaterialized
  readonly layout: LayoutOutput | null
  readonly styles: StudioStyles
  readonly selection: StudioSelection
  readonly editorTarget: StudioEditorTarget
  readonly selectedId: StudioState['selectedId']
  readonly zoom: number
  readonly currentPage: number
  readonly fitRequest: number
  readonly pageRequest: StudioState['pageRequest']
  readonly sectionRequest: StudioState['sectionRequest']
  readonly highlightedSectionIds: readonly ResumeSectionId[]
  readonly editable: boolean
  readonly canvasBlocks: readonly CanvasBlock[]
  readonly blockSectionIds: ReadonlyMap<LayoutBlockId, ResumeSectionId>
  readonly page: PageSetup | null
  readonly projected: ProjectedLayout | null
  readonly metrics: CanvasMetrics | null
  readonly pageCount: number
  readonly overflowEntries: readonly CanvasOverflowEntry[]
  readonly editor: EditorGeometry
}

function projectOf(
  materialized: MaterializedDocument | null,
  layout: LayoutOutput | null,
  page: PageSetup | null,
): ProjectedLayout | null {
  if (materialized === null || layout === null || page === null) return null
  return projectResume(materialized, layout, page)
}

function metricsOf(projected: ProjectedLayout | null, zoom: number): CanvasMetrics | null {
  return projected === null ? null : canvasMetrics(projected, zoom, PAGE_GAP)
}

function sectionMapOf(
  resume: Resume | null,
  layout: LayoutOutput | null,
): ReadonlyMap<LayoutBlockId, ResumeSectionId> {
  const map = new Map<LayoutBlockId, ResumeSectionId>()
  if (resume === null || layout === null) return map
  for (const block of layout.blocks) {
    const sectionId = sectionIdForBlock(resume, block.blockId)
    if (sectionId !== null) map.set(block.blockId, sectionId)
  }
  return map
}

function overflowEntriesOf(
  layout: LayoutOutput | null,
  projected: ProjectedLayout | null,
): readonly CanvasOverflowEntry[] {
  return (layout?.overflows ?? []).map((overflow) => ({
    ...overflow,
    block: projected?.blocks.find((block) => block.blockId === overflow.blockId) ?? null,
  }))
}

function editorBlockOf(
  editorTarget: StudioEditorTarget,
  projected: ProjectedLayout | null,
): ProjectedBlock | null {
  if (editorTarget === null || projected === null) return null
  return projected.blocks.find((block) => block.blockId === editorTarget.layoutBlockId) ?? null
}

function editorStyleOf(
  editorTarget: StudioEditorTarget,
  resume: StudioResume,
  styles: StudioStyles,
): TextStyle | null {
  if (editorTarget === null) return null
  if (editorTarget.kind === 'freeText') {
    const block = canvasBlockForLayoutBlock(resume, editorTarget.layoutBlockId)
    return block?.textStyle ?? styles?.freeText ?? null
  }
  return styles?.entryBody ?? null
}

function editorGeometryOf(
  editorTarget: StudioEditorTarget,
  projected: ProjectedLayout | null,
  metrics: CanvasMetrics | null,
  zoom: number,
  resume: StudioResume,
  styles: StudioStyles,
): EditorGeometry {
  const block = editorBlockOf(editorTarget, projected)
  const box = block === null || metrics === null ? null : pageBoxOf(metrics, block.pageIndex)
  return {
    block,
    rect: block === null || box === null ? null : blockScreenRect(block, box, zoom),
    style: editorStyleOf(editorTarget, resume, styles),
  }
}

export function useCanvasViewportData(): CanvasViewportData {
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

  const page = resume?.document.pageSetup ?? null
  const projected = useMemo(
    () => projectOf(materialized, layout, page),
    [materialized, layout, page],
  )
  const metrics = useMemo(() => metricsOf(projected, zoom), [projected, zoom])
  const blockSectionIds = useMemo(() => sectionMapOf(resume, layout), [resume, layout])
  const overflowEntries = useMemo(
    () => overflowEntriesOf(layout, projected),
    [layout, projected],
  )
  const editor = useMemo(
    () => editorGeometryOf(editorTarget, projected, metrics, zoom, resume, styles),
    [editorTarget, projected, metrics, zoom, resume, styles],
  )

  return {
    resume,
    materialized,
    layout,
    styles,
    selection,
    editorTarget,
    selectedId,
    zoom,
    currentPage,
    fitRequest,
    pageRequest,
    sectionRequest,
    highlightedSectionIds,
    editable: resume !== null && resume.status === 'draft',
    canvasBlocks: resume?.document.canvas.freeBlocks ?? [],
    blockSectionIds,
    page,
    projected,
    metrics,
    pageCount: layout?.pages.length ?? 0,
    overflowEntries,
    editor,
  }
}
