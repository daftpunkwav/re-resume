/**
 * @file ModuleDeleteDialog
 * @description Confirms deleting a whole custom module. The confirmation names
 * the entries that go with it and the resume sections that will start reporting
 * a missing module, so the cascade is not a surprise.
 *
 * Constraints:
 * - The counts and the referencing resumes are loaded before the dialog opens;
 *   deleting a module is a hard cascade and the reader deserves the exact cost.
 * - A failure keeps the dialog open and shows the reason.
 */

import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntryReference } from '../../../domain/info/ports/InfoEntryReferenceQuery'
import type { ReadableError } from '../../app/errorMessages'
import { Dialog } from '../../app/components/Dialog'
import { Notice } from '../../app/components/Notice'

export interface ModuleDeleteDialogProps {
  readonly module: CustomModuleDefinition
  readonly entryCount: number
  readonly references: readonly InfoEntryReference[]
  /** True while the referencing sections are still being read. */
  readonly referenceLoading: boolean
  readonly busy: boolean
  readonly error: ReadableError | null
  readonly onConfirm: () => void
  readonly onClose: () => void
}

function distinctResumeTitles(
  references: readonly InfoEntryReference[],
): readonly string[] {
  const titles = new Map<string, string>()
  for (const reference of references) titles.set(reference.resumeId, reference.resumeTitle)
  return [...titles.values()]
}

export function ModuleDeleteDialog({
  module,
  entryCount,
  references,
  referenceLoading,
  busy,
  error,
  onConfirm,
  onClose,
}: ModuleDeleteDialogProps) {
  const resumeTitles = distinctResumeTitles(references)
  const sectionCount = references.length
  const cascade =
    entryCount === 0
      ? '这个模块目前没有条目。'
      : `模块内的 ${entryCount.toString()} 条信息会一起删除，且无法恢复。`
  return (
    <Dialog
      open
      title={`删除自定义模块「${module.name}」？`}
      description={cascade}
      destructive
      busy={busy}
      confirmLabel="仍然删除"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      {referenceLoading ? (
        <p className="info-dialog-note">正在检查这个模块被哪些简历引用…</p>
      ) : sectionCount === 0 ? (
        <p className="info-dialog-note">没有简历章节引用这个模块。</p>
      ) : (
        <>
          <p className="info-dialog-note">
            有 {sectionCount.toString()} 处简历章节引用这个模块，删除后会显示为缺失引用：
          </p>
          <ul className="info-reference-list">
            {resumeTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
          <p className="info-dialog-note">简历本身不会被删除，可以在简历中移除或替换这些章节。</p>
        </>
      )}
      {error === null ? null : (
        <Notice tone="danger" title="没有删除成功">
          <p>{error.message}</p>
        </Notice>
      )}
    </Dialog>
  )
}
