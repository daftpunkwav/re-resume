/**
 * @file ResumeToolbar
 * @description The revision bar above the canvas: undo and redo across the
 * document's revision chain, the label of the revision currently shown, the
 * freeze transition with its confirmation, and the PDF export that reads the
 * plan before it asks for a destination.
 *
 * Constraints:
 * - Undo and redo move the cursor; they never create a revision, so the label
 *   follows the current revision instead of a counter.
 * - Freezing is confirmed and can refuse (empty document, unresolved
 *   references); the refusal text comes from the store notice.
 * - Export is offered only while a resume is loaded and no document write is in
 *   flight; the dialog shows overflows and warnings before the save dialog.
 */

import { useState } from 'react'

import type { Resume } from '../../../domain/resume/Resume'
import type { Revision } from '../../../domain/resume/Revision'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { showToast } from '../../app/stores/toastStore'
import { ExportResumeDialog } from './ExportResumeDialog'
import { ResumeIcon } from './resumeIcons'
import { formatUpdatedAt, resumeStatusLabel } from './resumeFormat'
import { useResumeStore } from './resumeStore'

interface RevisionHistory {
  readonly current: Revision | undefined
  readonly canUndo: boolean
  readonly canRedo: boolean
}

function historyOf(revisions: readonly Revision[], resume: Resume): RevisionHistory {
  const live = revisions
    .filter((revision) => revision.supersededAt === null)
    .sort((left, right) => left.seq - right.seq)
  const cursor = live.findIndex((revision) => revision.id === resume.currentRevision)
  return {
    current: revisions.find((revision) => revision.id === resume.currentRevision),
    canUndo: resume.status !== 'frozen' && cursor > 0,
    canRedo: resume.status !== 'frozen' && cursor >= 0 && cursor < live.length - 1,
  }
}

function revisionLabel(current: Revision | undefined): string {
  return current === undefined ? '当前修订' : `修订 ${current.seq.toString()} · ${current.label}`
}

function reportFailure(message: string): void {
  showToast('danger', useResumeStore.getState().actionError?.message ?? message)
}

function UndoRedoButtons({ resume, busy }: { readonly resume: Resume; readonly busy: boolean }) {
  const revisions = useResumeStore((state) => state.revisions)
  const undo = useResumeStore((state) => state.undo)
  const redo = useResumeStore((state) => state.redo)
  const history = historyOf(revisions, resume)
  return (
    <div className="studio-revision-group" role="group" aria-label="修订历史">
      <button
        type="button"
        className="revision-action"
        aria-label="撤销"
        title="撤销 (Ctrl/Cmd+Z)"
        disabled={!history.canUndo || busy}
        onClick={() => {
          void undo().then((accepted) => {
            if (!accepted) reportFailure('撤销没有完成')
          })
        }}
      >
        <ResumeIcon name="undo" />
      </button>
      <button
        type="button"
        className="revision-action"
        aria-label="重做"
        title="重做 (Ctrl/Cmd+Shift+Z)"
        disabled={!history.canRedo || busy}
        onClick={() => {
          void redo().then((accepted) => {
            if (!accepted) reportFailure('重做没有完成')
          })
        }}
      >
        <ResumeIcon name="redo" />
      </button>
      <span className="studio-revision-label" aria-live="polite">
        {revisionLabel(history.current)}
      </span>
    </div>
  )
}

function freezeDescription(resume: Resume): string {
  const base =
    '定稿会生成快照并锁定文档：之后不能再编辑、撤销或重做。需要继续修改时，复制为一份新草稿。'
  if (resume.snapshots.length === 0) return base
  return `${base} 上一次快照：${formatUpdatedAt(resume.snapshots[0]?.createdAt ?? resume.updatedAt)}。`
}

function FreezeAction({ resume, busy }: { readonly resume: Resume; readonly busy: boolean }) {
  const freeze = useResumeStore((state) => state.freeze)
  const duplicateResume = useResumeStore((state) => state.duplicateResume)
  const [freezeOpen, setFreezeOpen] = useState(false)
  return (
    <div className="studio-revision-group">
      {resume.status === 'frozen' ? (
        <>
          <Badge tone="info">{resumeStatusLabel(resume.status)}</Badge>
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={() => {
              void duplicateResume().then((accepted) => {
                if (accepted) showToast('success', '已复制为新的草稿')
              })
            }}
          >
            复制为新草稿
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          size="small"
          disabled={busy || resume.status !== 'draft'}
          onClick={() => setFreezeOpen(true)}
        >
          定稿
        </Button>
      )}
      <Dialog
        open={freezeOpen}
        title="定稿这份简历"
        description={freezeDescription(resume)}
        confirmLabel="定稿并创建快照"
        busy={busy}
        onConfirm={() => {
          void freeze().then((accepted) => {
            setFreezeOpen(false)
            if (accepted) showToast('success', '简历已定稿')
          })
        }}
        onClose={() => setFreezeOpen(false)}
      />
    </div>
  )
}

export function ResumeToolbar() {
  const resume = useResumeStore((state) => state.resume)
  const committing = useResumeStore((state) => state.committing)
  const [exportOpen, setExportOpen] = useState(false)
  if (resume === null) return null
  return (
    <div className="studio-revision-bar">
      <UndoRedoButtons resume={resume} busy={committing} />
      <div className="studio-revision-group">
        <FreezeAction resume={resume} busy={committing} />
        <Button
          variant="primary"
          size="small"
          disabled={committing}
          onClick={() => setExportOpen(true)}
        >
          导出 PDF
        </Button>
      </div>
      {exportOpen ? (
        <ExportResumeDialog resume={resume} open onClose={() => setExportOpen(false)} />
      ) : null}
    </div>
  )
}
