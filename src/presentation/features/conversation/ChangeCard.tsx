/**
 * @file ChangeCard
 * @description The per-change row inside a write tool card: what the write was,
 * whether it can still be taken back, and the button that takes it back. Two
 * mechanisms share the row: a library write is reversed by its change record, a
 * resume document write by moving the revision cursor back.
 *
 * Constraints:
 * - The undo button only appears while the change is undoable. Once the store
 *   reports it undone the row says so instead of offering the action again.
 * - A failed undo keeps the button and reports the reason through the shared
 *   conversation error, so the reader can retry after the blocking change.
 */

import { useConversationStore } from './stores/conversationStore'
import { FeatureIcon } from './icons'
import type { ChangeRecordId, ResumeId, RevisionId } from '../../../domain/shared/branded-id'

export interface ChangeCardProps {
  readonly changeId: ChangeRecordId
  readonly label: string
}

export function ChangeCard({ changeId, label }: ChangeCardProps) {
  const undone = useConversationStore((state) => state.undone.has(changeId))
  const busy = useConversationStore((state) => state.undoBusy.has(changeId))
  const undoChange = useConversationStore((state) => state.undoChange)

  return (
    <UndoRow
      label={label}
      undone={undone}
      busy={busy}
      onUndo={() => {
        void undoChange(changeId)
      }}
    />
  )
}

export interface RevisionCardProps {
  readonly resumeId: ResumeId
  readonly revisionId: RevisionId
  readonly label: string
}

/** One resume revision the assistant produced; undoable while it is the cursor. */
export function RevisionCard({ resumeId, revisionId, label }: RevisionCardProps) {
  const undone = useConversationStore((state) => state.undone.has(revisionId))
  const busy = useConversationStore((state) => state.undoBusy.has(revisionId))
  const undoRevision = useConversationStore((state) => state.undoRevision)

  return (
    <UndoRow
      label={label}
      undone={undone}
      busy={busy}
      onUndo={() => {
        void undoRevision(resumeId, revisionId)
      }}
    />
  )
}

interface UndoRowProps {
  readonly label: string
  readonly undone: boolean
  readonly busy: boolean
  readonly onUndo: () => void
}

function UndoRow({ label, undone, busy, onUndo }: UndoRowProps) {
  return (
    <div className={undone ? 'change-row change-row-undone' : 'change-row'}>
      <FeatureIcon name={undone ? 'check-circle' : 'pencil'} size={13} />
      <span className="change-row-label">{label}</span>
      {undone ? (
        <span className="change-row-state">已撤销</span>
      ) : (
        <button
          type="button"
          className="change-row-undo"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={onUndo}
        >
          <FeatureIcon name="undo" size={13} />
          {busy ? '撤销中…' : '撤销此项'}
        </button>
      )}
    </div>
  )
}
