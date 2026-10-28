/**
 * @file CanvasOverlays
 * @description The DOM layer over the canvas: overflow badges, the hint for a
 * document whose chapters have no entries yet, and the inline text editor. It
 * sits inside the canvas stage, so its absolute positions match the same
 * projected geometry the canvas draws.
 */

import { Button } from '../app/components/Button'
import type { MaterializedDocument } from '../../domain/resume/ResumeSnapshot'
import type { TextStyle } from '../../domain/resume/TextStyle'
import { useResumeStore } from '../features/resume/resumeStore'
import { saveEditorText, type StudioEditorTarget } from '../features/resume/resumeStore'
import { overflowReasonText } from '../features/resume/resumeFormat'
import {
  blockScreenRect,
  pageBoxOf,
  type CanvasMetrics,
} from './canvasProjection'
import { TextEditorOverlay } from './TextEditorOverlay'
import type { CanvasOverflowEntry, EditorGeometry } from './useCanvasViewportData'

interface EditorRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface CanvasOverlaysProps {
  readonly metrics: CanvasMetrics
  readonly zoom: number
  readonly materialized: MaterializedDocument
  readonly overflowEntries: readonly CanvasOverflowEntry[]
  readonly editorTarget: StudioEditorTarget | null
  readonly editor: EditorGeometry
  readonly onRequestPage: (pageIndex: number) => void
}

function editorLabel(target: StudioEditorTarget): string {
  if (target.kind === 'freeText') return '编辑自由文本'
  if (target.kind === 'summary') return '编辑个人简介'
  return '编辑条目改写'
}

function editorPlaceholder(target: StudioEditorTarget): string {
  if (target.kind === 'summary') return '写一段面向这份岗位的个人简介…'
  if (target.kind === 'freeText') return '输入画布文字；内容不能为空'
  if (target.layoutBlockId === 'header') return '写一段自我介绍，显示在姓名下方（可选）'
  return '改写这个条目的正文…'
}

function OverflowBadges({
  metrics,
  zoom,
  overflowEntries,
  onRequestPage,
}: Pick<CanvasOverlaysProps, 'metrics' | 'zoom' | 'overflowEntries' | 'onRequestPage'>) {
  return (
    <>
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
            onClick={() => onRequestPage(entry.pageIndex)}
          >
            !
          </button>
        )
      })}
    </>
  )
}

function EmptyContentHint() {
  const setActiveTab = useResumeStore((state) => state.setActiveTab)
  return (
    <div className="canvas-empty-hint" role="status">
      <p className="canvas-empty-title">这份简历还没有条目内容</p>
      <p className="canvas-empty-copy">章节已经排好，选择条目后正文会出现在这里。</p>
      <Button variant="secondary" size="small" onClick={() => setActiveTab('composition')}>
        去选择条目
      </Button>
    </div>
  )
}

function InlineEditor({
  target,
  rect,
  style,
  zoom,
}: {
  readonly target: StudioEditorTarget
  readonly rect: EditorRect
  readonly style: TextStyle
  readonly zoom: number
}) {
  const closeEditor = useResumeStore((state) => state.closeEditor)
  return (
    <TextEditorOverlay
      key={target.layoutBlockId}
      left={rect.left}
      top={rect.top}
      width={rect.width}
      height={rect.height}
      zoom={zoom}
      text={target.text}
      style={style}
      label={editorLabel(target)}
      emptyError={target.kind === 'freeText' ? '自由文本不能为空。' : null}
      placeholder={editorPlaceholder(target)}
      multiline={target.kind !== 'freeText' || rect.height > 24 * zoom}
      onCommit={async (text) => {
        const accepted = await saveEditorText(text)
        if (accepted) closeEditor()
        return accepted
      }}
      onCancel={closeEditor}
    />
  )
}

export function CanvasOverlays({
  metrics,
  zoom,
  materialized,
  overflowEntries,
  editorTarget,
  editor,
  onRequestPage,
}: CanvasOverlaysProps) {
  return (
    <>
      <OverflowBadges
        metrics={metrics}
        zoom={zoom}
        overflowEntries={overflowEntries}
        onRequestPage={onRequestPage}
      />
      {materialized.blocks.every((block) => block.role === 'sectionHeader') ? (
        <EmptyContentHint />
      ) : null}
      {editorTarget !== null && editor.rect !== null && editor.style !== null ? (
        <InlineEditor
          target={editorTarget}
          rect={editor.rect}
          style={editor.style}
          zoom={zoom}
        />
      ) : null}
    </>
  )
}
