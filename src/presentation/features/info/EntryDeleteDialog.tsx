/**
 * @file EntryDeleteDialog
 * @description The two-step deletion of one information entry. The first step
 * asks for confirmation; when the entry is still selected by a resume the use
 * case refuses, and the same dialog becomes the reference report with the
 * destructive action renamed to say what it will break.
 *
 * Constraints:
 * - The referencing resume titles come from the read the panel makes after the
 *   refusal; the dialog itself never asks a service.
 * - The dialog stays open on a failure so the reason remains readable.
 */

import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { InfoEntryReference } from '../../../domain/info/ports/InfoEntryReferenceQuery'
import type { ReadableError } from '../../app/errorMessages'
import { Dialog } from '../../app/components/Dialog'
import { Notice } from '../../app/components/Notice'

export type EntryDeletePhase = 'confirm' | 'referenced'

export interface EntryDeleteDialogProps {
  readonly entry: InfoEntry
  readonly phase: EntryDeletePhase
  readonly references: readonly InfoEntryReference[]
  readonly busy: boolean
  readonly error: ReadableError | null
  readonly onConfirm: () => void
  readonly onClose: () => void
}

/** One line per distinct resume, in the order the reference query returned them. */
function ReferenceList({ references }: { readonly references: readonly InfoEntryReference[] }) {
  const byResume = new Map<string, string>()
  for (const reference of references) byResume.set(reference.resumeId, reference.resumeTitle)
  return (
    <ul className="info-reference-list">
      {[...byResume.values()].map((title) => (
        <li key={title}>{title}</li>
      ))}
    </ul>
  )
}

export function EntryDeleteDialog({
  entry,
  phase,
  references,
  busy,
  error,
  onConfirm,
  onClose,
}: EntryDeleteDialogProps) {
  const referenced = phase === 'referenced'
  return (
    <Dialog
      open
      title={referenced ? '这条信息仍被简历引用' : '删除这条信息？'}
      description={
        referenced
          ? `${references.length.toString()} 处简历章节正在使用「${entry.title}」。删除后这些章节会显示为缺失引用。`
          : `「${entry.title}」将从信息库中移除，且无法恢复。`
      }
      destructive
      busy={busy}
      confirmLabel={referenced ? '仍然删除' : '删除'}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      {referenced ? <ReferenceList references={references} /> : null}
      {error === null ? null : (
        <Notice tone="danger" title="没有删除成功">
          <p>{error.message}</p>
        </Notice>
      )}
      {referenced ? (
        <p className="info-dialog-note">
          如果只是想更新经历，可以先关闭这个对话框，在引用它的简历中替换条目。
        </p>
      ) : null}
    </Dialog>
  )
}
