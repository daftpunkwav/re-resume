/**
 * @file ResumeToolbar
 * @description The revision bar above the canvas: undo and redo across the
 * document's revision chain, the label of the revision currently shown, and the
 * freeze transition with its confirmation. The panel edits a document; it does
 * not export one.
 *
 * Constraints:
 * - Undo and redo move the cursor; they never create a revision, so the label
 *   follows the current revision instead of a counter.
 * - Freezing is confirmed and can refuse (empty document, unresolved
 *   references); the refusal text comes from the store notice.
 */

import { useState } from 'react'

import { resumeStatusLabel, formatUpdatedAt } from './resumeFormat'
import { useResumeStore } from './resumeStore'
import { ResumeIcon } from './resumeIcons'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { showToast } from '../../app/stores/toastStore'

export function ResumeToolbar() {
  const resume = useResumeStore((state) => state.resume)
  const revisions = useResumeStore((state) => state.revisions)
  const committing = useResumeStore((state) => state.committing)
  const undo = useResumeStore((state) => state.undo)
  const redo = useResumeStore((state) => state.redo)
  const freeze = useResumeStore((state) => state.freeze)
  const duplicateResume = useResumeStore((state) => state.duplicateResume)
  const [freezeOpen, setFreezeOpen] = useState(false)

  if (resume === null) return null
  const frozen = resume.status === 'frozen'
  const busy = committing
  const live = revisions
    .filter((revision) => revision.supersededAt === null)
    .sort((left, right) => left.seq - right.seq)
  const cursorIndex = live.findIndex((revision) => revision.id === resume.currentRevision)
  const canUndo = cursorIndex > 0 && !frozen
  const canRedo = cursorIndex >= 0 && cursorIndex < live.length - 1 && !frozen
  const current = revisions.find((revision) => revision.id === resume.currentRevision)

  return (
    <div className="studio-revision-bar">
      <div className="studio-revision-group" role="group" aria-label="修订历史">
        <button
          type="button"
          className="revision-action"
          aria-label="撤销"
          title="撤销 (Ctrl/Cmd+Z)"
          disabled={!canUndo || busy}
          onClick={() => {
            void undo().then((accepted) => {
              if (!accepted) showToast('danger', useResumeStore.getState().actionError?.message ?? '撤销没有完成')
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
          disabled={!canRedo || busy}
          onClick={() => {
            void redo().then((accepted) => {
              if (!accepted) showToast('danger', useResumeStore.getState().actionError?.message ?? '重做没有完成')
            })
          }}
        >
          <ResumeIcon name="redo" />
        </button>
        <span className="studio-revision-label" aria-live="polite">
          {current === undefined
            ? '当前修订'
            : `修订 ${current.seq.toString()} · ${current.label}`}
        </span>
      </div>

      <div className="studio-revision-group">
        {frozen ? (
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
      </div>

      <Dialog
        open={freezeOpen}
        title="定稿这份简历"
        description={`定稿会生成快照并锁定文档：之后不能再编辑、撤销或重做。需要继续修改时，复制为一份新草稿。${
          resume.snapshots.length > 0
            ? ` 上一次快照：${formatUpdatedAt(resume.snapshots[0]?.createdAt ?? resume.updatedAt)}。`
            : ''
        }`}
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
