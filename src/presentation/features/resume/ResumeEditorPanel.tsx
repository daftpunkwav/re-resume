/**
 * @file ResumeEditorPanel
 * @description One resume, end to end: its header and actions, its page setup,
 * its palette and the canvas that draws it. Every mutation in this file leaves
 * through commit(), undo(), redo(), freeze() or duplicate() on the composition
 * root, so the revision chain the user can walk is the record of what happened.
 *
 * Responsibilities:
 * - Load the resume, then materialize and lay it out again after every change
 * - Turn editor intents into pure DocumentChange transitions and commit them
 * - Refuse editing affordances on a frozen resume and say why
 * - Confirm the consequences of freezing before doing it
 *
 * Constraints:
 * - next is pure. It reads the state it is handed and returns a new one; it
 *   captures nothing, because the revision it produces is replayed by undo.
 * - Nothing here changes a resume directly. commit() is the only write path.
 */

import { useCallback, useRef, useState } from 'react'

import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { Notice } from '../../app/components/Notice'
import { Spinner } from '../../app/components/Spinner'
import { useServices } from '../../app/ApplicationServicesProvider'
import type { ReadableError } from '../../app/errorMessages'
import { useNavigation } from '../../app/navigationStore'
import { useOperation } from '../../app/useOperation'
import { useResource } from '../../app/useResource'

import type { ResumeWorkbench } from '../../../bootstrap/compositionRoot'
import type { Block } from '../../../domain/resume/Block'
import type { DocumentChange, DocumentState } from '../../../domain/resume/DocumentChange'
import { DEFAULT_FLOW_LAYOUT, isAbsoluteLayout, isFlowLayout } from '../../../domain/resume/Layout'
import type { LayoutOutput } from '../../../domain/resume/PageLayout'
import type { PageSetup } from '../../../domain/resume/PageSetup'
import type { Resume } from '../../../domain/resume/Resume'
import type { MaterializedBlock } from '../../../domain/resume/ResumeSnapshot'
import type { BlockId, ResumeId } from '../../../domain/shared/branded-id'

import { ResumeCanvas } from '../../canvas/ResumeCanvas'
import type { BlockGesture } from '../../canvas/ResumeCanvas'
import { BlockPalette } from './BlockPalette'
import { PageSetupForm } from './PageSetupForm'
import { SelectedBlockPanel } from './SelectedBlockPanel'

import './resume.css'

export interface ResumeEditorPanelProps {
  readonly resumeId: ResumeId
  /** Told after every accepted change so the list can refresh its status. */
  readonly onResumeChanged: () => void
  /**
   * The outcome is held by the workspace rather than here. Copying a resume
   * selects the copy, and the panel is keyed by the selected id, so a notice
   * set inside this panel would be discarded by the very remount it caused.
   */
  readonly onOutcome: (outcome: OperationOutcome | null) => void
}

interface ResumePreview {
  readonly blocks: readonly MaterializedBlock[]
  readonly layout: LayoutOutput
}

type NoticeTone = 'info' | 'success' | 'warning'

export interface OperationOutcome {
  readonly tone: NoticeTone
  readonly title: string
}

/** Metadata every user change carries. The run id stays null: this is the user. */
function userChange(label: string, next: (state: DocumentState) => DocumentState): DocumentChange {
  return { label, origin: 'user', runId: null, next }
}

export function appendBlock(label: string, block: Block): DocumentChange {
  return userChange(label, (state) => ({ ...state, blocks: [...state.blocks, block] }))
}

/**
 * Moves a block to before `beforeBlockId` in the sequence, or to the end when
 * the anchor is null. An anchor carries the drop's meaning across the gap
 * between the drawn document and the stored one — an index counted on the
 * canvas would land somewhere else the moment absolute blocks sit in between.
 * A block that is no longer in the document leaves it untouched; the canvas
 * can be one interaction behind an undo, and a change that invented a
 * position for a missing block would write history that never happened.
 */
export function reorderBlocks(
  label: string,
  blockId: BlockId,
  beforeBlockId: BlockId | null,
): DocumentChange {
  return userChange(label, (state) => {
    const from = state.blocks.findIndex((block) => block.id === blockId)
    if (from < 0) return state
    const blocks = [...state.blocks]
    const [moved] = blocks.splice(from, 1)
    if (moved === undefined) return state
    const anchorIndex =
      beforeBlockId === null
        ? blocks.length
        : blocks.findIndex((block) => block.id === beforeBlockId)
    blocks.splice(anchorIndex < 0 ? blocks.length : anchorIndex, 0, moved)
    return { ...state, blocks }
  })
}

export function placeAbsoluteBlock(
  label: string,
  blockId: BlockId,
  x: number,
  y: number,
): DocumentChange {
  return userChange(label, (state) => ({
    ...state,
    blocks: state.blocks.map((block) =>
      block.id === blockId && isAbsoluteLayout(block.layout)
        ? { ...block, layout: { ...block.layout, x, y } }
        : block,
    ),
  }))
}

/**
 * The committed text of a canvas editing session. A block that an undo removed
 * while the editor was open, or one that never was a text block, leaves the
 * document untouched rather than writing a revision about nothing.
 */
export function updateBlockText(label: string, blockId: BlockId, text: string): DocumentChange {
  return userChange(label, (state) => {
    const target = state.blocks.find((block) => block.id === blockId)
    if (target === undefined || target.content.type !== 'text') return state
    return {
      ...state,
      blocks: state.blocks.map((block) =>
        block.id === blockId ? { ...block, content: { type: 'text', text } } : block,
      ),
    }
  })
}

export function removeBlock(label: string, blockId: BlockId): DocumentChange {
  return userChange(label, (state) => {
    if (!state.blocks.some((block) => block.id === blockId)) return state
    return { ...state, blocks: state.blocks.filter((block) => block.id !== blockId) }
  })
}

/**
 * Pins a flow block where the layout drew it. The box arrives from the current
 * LayoutOutput, so nothing moves on conversion — and a box that does not fit
 * the content box stays as it is, for layout() to report as an overflow.
 */
export function convertBlockToAbsolute(
  label: string,
  blockId: BlockId,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  zIndex: number,
): DocumentChange {
  return userChange(label, (state) => {
    if (!state.blocks.some((block) => block.id === blockId && isFlowLayout(block.layout))) {
      return state
    }
    return {
      ...state,
      blocks: state.blocks.map((block) =>
        block.id === blockId && isFlowLayout(block.layout)
          ? { ...block, layout: { mode: 'absolute', ...box, zIndex, rotation: 0 } }
          : block,
      ),
    }
  })
}

export function convertBlockToFlow(label: string, blockId: BlockId): DocumentChange {
  return userChange(label, (state) => {
    if (!state.blocks.some((block) => block.id === blockId && isAbsoluteLayout(block.layout))) {
      return state
    }
    return {
      ...state,
      blocks: state.blocks.map((block) =>
        block.id === blockId && isAbsoluteLayout(block.layout)
          ? { ...block, layout: DEFAULT_FLOW_LAYOUT }
          : block,
      ),
    }
  })
}

/** A converted block lands on top: above every absolute block already there. */
export function nextAbsoluteZIndex(blocks: readonly Block[]): number {
  let highest = 0
  for (const block of blocks) {
    if (isAbsoluteLayout(block.layout) && block.layout.zIndex > highest) {
      highest = block.layout.zIndex
    }
  }
  return highest + 1
}

/** The committed box of a corner drag. Only an absolute block can be resized. */
export function resizeAbsoluteBlock(
  label: string,
  blockId: BlockId,
  width: number,
  height: number,
): DocumentChange {
  return userChange(label, (state) => {
    if (!state.blocks.some((block) => block.id === blockId && isAbsoluteLayout(block.layout))) {
      return state
    }
    return {
      ...state,
      blocks: state.blocks.map((block) =>
        block.id === blockId && isAbsoluteLayout(block.layout)
          ? { ...block, layout: { ...block.layout, width, height } }
          : block,
      ),
    }
  })
}

/**
 * Trades the z positions of two absolute blocks. Swapping — rather than
 * assigning neighbours — keeps the total order intact no matter what the
 * document looked like when the click landed.
 */
export function swapBlockZOrder(label: string, firstId: BlockId, secondId: BlockId): DocumentChange {
  return userChange(label, (state) => {
    const first = state.blocks.find((block) => block.id === firstId)
    const second = state.blocks.find((block) => block.id === secondId)
    if (
      first === undefined ||
      second === undefined ||
      !isAbsoluteLayout(first.layout) ||
      !isAbsoluteLayout(second.layout)
    ) {
      return state
    }
    const firstZ = first.layout.zIndex
    const secondZ = second.layout.zIndex
    return {
      ...state,
      blocks: state.blocks.map((block) => {
        if (!isAbsoluteLayout(block.layout)) return block
        if (block.id === firstId) return { ...block, layout: { ...block.layout, zIndex: secondZ } }
        if (block.id === secondId) return { ...block, layout: { ...block.layout, zIndex: firstZ } }
        return block
      }),
    }
  })
}

export function changePageSetup(label: string, pageSetup: PageSetup): DocumentChange {
  return userChange(label, (state) => ({ ...state, pageSetup }))
}

/**
 * Materializing and laying out is two reads against the same document. A null
 * resume has nothing to resolve yet, which the panel renders as a spinner
 * rather than as an empty canvas.
 */
async function loadPreview(
  workbench: ResumeWorkbench,
  resume: Resume | null,
): Promise<ResumePreview | null> {
  if (resume === null) return null
  const blocks = await workbench.materialize(resume.id)
  return { blocks, layout: workbench.layOut(blocks, resume.pageSetup) }
}

export function ResumeEditorPanel({
  resumeId,
  onResumeChanged,
  onOutcome,
}: ResumeEditorPanelProps) {
  const { resumes } = useServices()
  const selectResume = useNavigation((state) => state.selectResume)

  const loadResume = useCallback(() => resumes.get(resumeId), [resumes, resumeId])
  const resumeResource = useResource(loadResume, [resumes, resumeId])
  const resume = resumeResource.data
  // Re-materializing after every accepted change is what makes the canvas show
  // what was actually stored rather than what was intended.
  const loadCurrentPreview = useCallback(() => loadPreview(resumes, resume), [resumes, resume])
  const preview = useResource(loadCurrentPreview, [resumes, resume])

  const [selectedBlockId, setSelectedBlockId] = useState<BlockId | null>(null)
  const [confirmingFreeze, setConfirmingFreeze] = useState(false)

  /**
   * One error surface and one refresh path for every mutation here. The command
   * to run is parked in a ref so each call site can hand over its own closure
   * without useOperation having to know which of them it is running.
   */
  const pending = useRef<() => Promise<unknown>>(async () => undefined)
  const documentOp = useOperation(
    useCallback(async () => pending.current(), []),
    async () => {
      await resumeResource.reload()
      onResumeChanged()
    },
  )

  const dispatch = (
    run: () => Promise<unknown>,
    success?: OperationOutcome,
  ): void => {
    onOutcome(null)
    pending.current =
      success === undefined
        ? run
        : async () => {
            await run()
            onOutcome(success)
          }
    void documentOp.run()
  }

  if (resumeResource.loading && resume === null) {
    return <Spinner label="正在读取简历…" />
  }
  if (resume === null) {
    return (
      <Notice tone="danger" title="这份简历已经不存在了。">
        <p>{describeResumeReadError(resumeResource.error)}</p>
      </Notice>
    )
  }

  const frozen = resume.status === 'frozen'
  const editable = !frozen && !documentOp.busy
  // A block can leave the document while it is selected — an undo, or a commit
  // that removed it. Deriving the selection here means the canvas never shows
  // a frame around a block the document no longer holds.
  const selected =
    selectedBlockId !== null && resume.blocks.some((block) => block.id === selectedBlockId)
      ? selectedBlockId
      : null
  const selectedBlock =
    selected === null ? undefined : resume.blocks.find((block) => block.id === selected)
  // The drawn box a conversion pins: without a layout there is nowhere honest
  // to put the block, so the affordance waits until the preview exists. A
  // later-page block is not offered the pin at all: absolute placement draws on
  // page one in v1, so pinning would silently move the block back a page.
  const selectedLaidOut =
    selected === null
      ? undefined
      : preview.data?.layout.blocks.find((entry) => entry.blockId === selected)
  const canPinSelected = selectedLaidOut !== undefined && selectedLaidOut.pageIndex === 0
  // The z neighbours of the selected block: who it would swap places with.
  // Array#sort is stable, so equal z positions keep document order — and a
  // swap between equal positions would write a revision that changes nothing,
  // so a neighbour on the same z offers no move at all.
  const zOrder: { readonly id: BlockId; readonly zIndex: number }[] = []
  for (const block of resume.blocks) {
    if (isAbsoluteLayout(block.layout)) {
      zOrder.push({ id: block.id, zIndex: block.layout.zIndex })
    }
  }
  zOrder.sort((left, right) => left.zIndex - right.zIndex)
  const selectedZPosition =
    selected === null ? -1 : zOrder.findIndex((entry) => entry.id === selected)
  const selectedEntry = selectedZPosition < 0 ? undefined : zOrder[selectedZPosition]
  const zNeighbour = (offset: -1 | 1): BlockId | null => {
    if (selectedEntry === undefined) return null
    const other = zOrder[selectedZPosition + offset]
    if (other === undefined || other.zIndex === selectedEntry.zIndex) return null
    return other.id
  }
  const zAbove = zNeighbour(1)
  const zBelow = zNeighbour(-1)

  const commit = (change: DocumentChange): Promise<unknown> => resumes.commit(resumeId, change)

  const addBlock = (block: Block): void => {
    dispatch(() => commit(appendBlock('添加区块', block)))
  }

  const handleGesture = (gesture: BlockGesture): void => {
    dispatch(() =>
      commit(
        gesture.kind === 'reorder'
          ? reorderBlocks('移动区块', gesture.blockId, gesture.beforeBlockId)
          : gesture.kind === 'place'
            ? placeAbsoluteBlock('移动区块', gesture.blockId, gesture.x, gesture.y)
            : resizeAbsoluteBlock('调整区块大小', gesture.blockId, gesture.width, gesture.height),
      ),
    )
  }

  const editBlockText = (blockId: BlockId, text: string): void => {
    dispatch(() => commit(updateBlockText('编辑文字', blockId, text)))
  }

  const removeSelected = (): void => {
    if (selectedBlock === undefined) return
    const blockId = selectedBlock.id
    dispatch(() => commit(removeBlock('删除区块', blockId)))
  }

  const pinSelectedAbsolute = (): void => {
    if (selectedBlock === undefined || selectedLaidOut === undefined) return
    const blockId = selectedBlock.id
    const box = {
      x: selectedLaidOut.x,
      y: selectedLaidOut.y,
      width: selectedLaidOut.width,
      height: selectedLaidOut.height,
    }
    const zIndex = nextAbsoluteZIndex(resume.blocks)
    dispatch(() => commit(convertBlockToAbsolute('转为绝对定位', blockId, box, zIndex)))
  }

  const releaseSelectedToFlow = (): void => {
    if (selectedBlock === undefined) return
    const blockId = selectedBlock.id
    dispatch(() => commit(convertBlockToFlow('转为常规流', blockId)))
  }

  const swapSelectedZOrder = (otherId: BlockId): void => {
    if (selected === null) return
    const current = selected
    dispatch(() => commit(swapBlockZOrder('调整层级', current, otherId)))
  }

  const raiseSelected = (): void => {
    if (selected === null || zAbove === null) return
    swapSelectedZOrder(zAbove)
  }

  const lowerSelected = (): void => {
    if (selected === null || zBelow === null) return
    swapSelectedZOrder(zBelow)
  }

  const copyResume = (): void => {
    dispatch(
      async () => {
        const copyId = await resumes.duplicate({ sourceResumeId: resumeId })
        selectResume(copyId)
      },
      { tone: 'success', title: '已复制为一份新的草稿。' },
    )
  }

  // The outcome depends on what the run produced (saved, saved with a claim
  // notice, or a dismissed dialog), so it is reported from inside the run
  // rather than declared as dispatch's static success notice.
  const exportResumePdf = (): void => {
    dispatch(async () => {
      const saved = await resumes.exportPdfToFile(resumeId)
      if (saved.outcome === 'cancelled') return
      onOutcome(
        saved.pendingClaimBlocks.length > 0
          ? { tone: 'warning', title: `PDF 已导出到 ${saved.path}，其中引用了待确认的断言。` }
          : { tone: 'success', title: `PDF 已导出到 ${saved.path}。` },
      )
    })
  }

  return (
    <div className="resume-editor">
      <ResumeToolbar
        resume={resume}
        frozen={frozen}
        busy={documentOp.busy}
        onUndo={() => dispatch(() => resumes.undo(resumeId))}
        onRedo={() => dispatch(() => resumes.redo(resumeId))}
        onCopy={copyResume}
        onExportPdf={exportResumePdf}
        onFreeze={() => setConfirmingFreeze(true)}
      />

      {frozen ? (
        <Notice tone="info" title="已定稿，复制一份草稿继续修改">
          <p>定稿之后这份简历不再接受任何改动；复制会得到一份可以继续编辑的草稿。</p>
        </Notice>
      ) : null}

      <OperationFailure error={documentOp.error} onDismiss={documentOp.clearError} />

      <div className="split resume-editor-grid">
        <div className="resume-editor-sidebar">
          <PageSetupForm
            pageSetup={resume.pageSetup}
            disabled={!editable}
            onChange={(pageSetup) => dispatch(() => commit(changePageSetup('调整页面设置', pageSetup)))}
          />
          <BlockPalette disabled={!editable} onAddBlock={addBlock} />
          {selectedBlock === undefined ? null : (
            <SelectedBlockPanel
              block={selectedBlock}
              disabled={!editable}
              canMakeAbsolute={canPinSelected}
              canRaise={zAbove !== null}
              canLower={zBelow !== null}
              onDelete={removeSelected}
              onMakeAbsolute={pinSelectedAbsolute}
              onMakeFlow={releaseSelectedToFlow}
              onRaise={raiseSelected}
              onLower={lowerSelected}
            />
          )}
        </div>

        <div className="resume-editor-canvas">
          <ResumeCanvasArea
            preview={preview.data}
            error={preview.error}
            resume={resume}
            editable={editable}
            selectedBlockId={selected}
            onSelectBlock={setSelectedBlockId}
            onGesture={handleGesture}
            onEditText={editBlockText}
          />
        </div>
      </div>

      <Dialog
        open={confirmingFreeze}
        title="定稿这份简历"
        confirmLabel="定稿"
        busy={documentOp.busy}
        onConfirm={() => {
          setConfirmingFreeze(false)
          dispatch(
            () => resumes.freeze(resumeId),
            {
              tone: 'success',
              title: '简历已定稿，导出将使用这份快照。',
            },
          )
        }}
        onClose={() => setConfirmingFreeze(false)}
      >
        <p>定稿会带来两个不可撤销的结果：</p>
        <ul>
          <li>生成本次内容的快照，此后的经历库改动不再影响它。</li>
          <li>简历变为只读，要继续修改只能先复制一份草稿。</li>
        </ul>
      </Dialog>
    </div>
  )
}

/**
 * The identity of the open document and the four things that can be done to
 * it. Split out because none of it decides anything: every control reports an
 * intent, and the panel decides what that intent means.
 */
function ResumeToolbar({
  resume,
  frozen,
  busy,
  onUndo,
  onRedo,
  onCopy,
  onExportPdf,
  onFreeze,
}: {
  readonly resume: Resume
  readonly frozen: boolean
  readonly busy: boolean
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onCopy: () => void
  readonly onExportPdf: () => void
  readonly onFreeze: () => void
}) {
  return (
    <div className="toolbar">
      <div className="resume-identity">
        <div className="resume-identity-text">
          <h2 className="resume-identity-title">{resume.title}</h2>
          <p className="resume-identity-role">{resume.targetRole ?? '未设置目标岗位'}</p>
        </div>
        <Badge tone={frozen ? 'info' : 'neutral'}>{frozen ? '已定稿' : '草稿'}</Badge>
      </div>
      <div className="toolbar-group">
        <Button size="small" icon="undo" disabled={busy || frozen} onClick={onUndo}>
          撤销
        </Button>
        <Button size="small" icon="redo" disabled={busy || frozen} onClick={onRedo}>
          重做
        </Button>
        <Button size="small" icon="copy" disabled={busy} onClick={onCopy}>
          复制
        </Button>
        {/* Both statuses export: a frozen resume renders its snapshot, a draft
            its current blocks. */}
        <Button size="small" icon="export" disabled={busy} onClick={onExportPdf}>
          导出 PDF
        </Button>
        <Button
          size="small"
          icon="freeze"
          variant="primary"
          disabled={busy || frozen}
          onClick={onFreeze}
        >
          定稿
        </Button>
      </div>
    </div>
  )
}

/**
 * The drawing, or the two reasons there is not one yet. A document whose
 * layout could not be produced is reported rather than left as a blank sheet
 * the user would read as an empty resume.
 */
function ResumeCanvasArea({
  preview,
  error,
  resume,
  editable,
  selectedBlockId,
  onSelectBlock,
  onGesture,
  onEditText,
}: {
  readonly preview: ResumePreview | null
  readonly error: ReadableError | null
  readonly resume: Resume
  readonly editable: boolean
  readonly selectedBlockId: BlockId | null
  readonly onSelectBlock: (blockId: BlockId | null) => void
  readonly onGesture: (gesture: BlockGesture) => void
  readonly onEditText: (blockId: BlockId, text: string) => void
}) {
  if (preview === null) {
    return error === null ? (
      <Spinner label="正在排版…" />
    ) : (
      <Notice tone="danger" title="排版失败">
        <p>{error.message}</p>
      </Notice>
    )
  }
  return (
    <ResumeCanvas
      layout={preview.layout}
      page={resume.pageSetup}
      blocks={resume.blocks}
      editable={editable}
      selectedBlockId={selectedBlockId}
      onSelectBlock={onSelectBlock}
      onGesture={onGesture}
      onEditText={onEditText}
    />
  )
}

function OperationFailure({
  error,
  onDismiss,
}: {
  readonly error: ReadableError | null
  readonly onDismiss: () => void
}) {
  if (error === null) return null
  return (
    <Notice
      tone="danger"
      title={error.message}
      actions={
        <Button size="small" variant="ghost" onClick={onDismiss}>
          知道了
        </Button>
      }
    >
      {error.blockers.length === 0 ? null : (
        <ul className="resume-blockers">
          {error.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
    </Notice>
  )
}

function describeResumeReadError(error: ReadableError | null): string {
  return error === null ? '它可能已经被删除，或者这一份从来没有保存成功。' : error.message
}
