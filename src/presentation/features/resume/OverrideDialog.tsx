/**
 * @file OverrideDialog
 * @description Viewing and editing the resume-level rewrites: the summary or one
 * entry's body. Agent-authored text is marked until the user edits it, and an
 * entry rewrite can be written back into the shared library entry through the
 * application use case — the dialog only collects the choice.
 *
 * Constraints:
 * - The text limit is the document's (summary 4000, entry 2000 code points);
 *   the domain re-validates, this counter is only the visible guard.
 * - Saving back to the library is never automatic: it needs an explicit click
 *   and a field to write into.
 */

import { useState } from 'react'

import type { InfoEntryId, ResumeSectionId } from '../../../domain/shared/branded-id'
import { countCodePoints } from '../../../domain/info/codePoints'
import { fieldDescriptors } from '../../../domain/info/InfoFieldValue'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { SegmentedControl } from '../../app/components/SegmentedControl'
import { SelectField } from '../../app/components/SelectField'
import { TextAreaField } from '../../app/components/TextAreaField'
import { showToast } from '../../app/stores/toastStore'
import { isAgentAuthored } from './resumeFormat'
import { useResumeStore } from './resumeStore'

export type OverrideTargetSelection =
  | { readonly kind: 'summary' }
  | {
      readonly kind: 'entry'
      readonly entryId: InfoEntryId
      readonly sectionId: ResumeSectionId | null
    }

export interface OverrideDialogProps {
  readonly target: OverrideTargetSelection
  readonly onClose: () => void
}

const SUMMARY_LIMIT = 4000
const ENTRY_LIMIT = 2000

const MODE_OPTIONS = [
  { id: 'replace' as const, label: '替换字段' },
  { id: 'append' as const, label: '追加一行' },
]

/**
 * The dialog is mounted per opening, so its draft starts from the stored text;
 * there is no open flag to synchronise and no draft from a previous target.
 */
export function OverrideDialog({ target, onClose }: OverrideDialogProps) {
  const resume = useResumeStore((state) => state.resume)
  const entries = useResumeStore((state) => state.entries)
  const customModules = useResumeStore((state) => state.customModules)
  const committing = useResumeStore((state) => state.committing)
  const writeSummaryOverride = useResumeStore((state) => state.writeSummaryOverride)
  const writeEntryOverride = useResumeStore((state) => state.writeEntryOverride)
  const deleteOverride = useResumeStore((state) => state.deleteOverride)
  const saveOverrideToLibrary = useResumeStore((state) => state.saveOverrideToLibrary)

  const entry =
    target.kind === 'entry'
      ? (entries.find((candidate) => candidate.id === target.entryId) ?? null)
      : null
  const customModule =
    entry?.customModuleId === null || entry?.customModuleId === undefined
      ? null
      : (customModules.find((module) => module.id === entry.customModuleId) ?? null)
  const existing =
    resume === null
      ? undefined
      : resume.document.overrides.find((override) => {
          if (override.target.kind === 'summary') return target.kind === 'summary'
          return target.kind === 'entry' && override.target.entryId === target.entryId
        })
  const textareaFields =
    entry === null
      ? []
      : fieldDescriptors(entry.moduleKind, customModule).filter(
          (field) => field.type === 'textarea',
        )

  const [text, setText] = useState(existing?.text ?? '')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [libraryField, setLibraryField] = useState(textareaFields[0]?.key ?? '')
  const [libraryMode, setLibraryMode] = useState<'replace' | 'append'>('replace')

  const limit = target.kind === 'summary' ? SUMMARY_LIMIT : ENTRY_LIMIT
  const frozen = resume?.status === 'frozen'
  const busy = committing
  const title = target.kind === 'summary' ? '个人简介 / 总结' : '条目改写'
  const count = countCodePoints(text)
  const tooLong = count > limit

  const save = async (): Promise<void> => {
    if (target === null) return
    if (text.trim() === '') {
      setError('文案不能为空；删除请使用「删除这段文案」。')
      return
    }
    if (tooLong) {
      setError(`最多 ${limit.toString()} 个字符。`)
      return
    }
    const accepted =
      target.kind === 'summary'
        ? await writeSummaryOverride(text)
        : await writeEntryOverride(target.entryId, text)
    if (accepted) {
      showToast('success', target.kind === 'summary' ? '总结已保存' : '改写已保存')
      onClose()
    } else {
      setError('这次修改没有保存，请重试。')
    }
  }

  const remove = async (): Promise<void> => {
    if (existing === undefined) return
    const accepted = await deleteOverride(existing.id)
    if (accepted) {
      showToast('success', '这段文案已删除')
      onClose()
    } else {
      setError('删除没有完成，请重试。')
    }
  }

  const writeBack = async (): Promise<void> => {
    if (existing === undefined || libraryField === '') return
    const accepted = await saveOverrideToLibrary({
      overrideId: existing.id,
      targetFieldKey: libraryField,
      mode: libraryMode,
    })
    if (accepted) {
      showToast('success', '已保存回信息库')
      onClose()
    } else {
      setError('没有保存回信息库，请重试。')
    }
  }

  return (    <Dialog
      open
      title={title}
      description={
        target.kind === 'entry' && entry === null
          ? '原条目已删除：这段改写不会渲染，可以删除。'
          : '这段文案只作用于当前简历，不修改信息库条目。'
      }
      confirmLabel="保存这段文案"
      busy={busy}
      onConfirm={() => {
        void save()
      }}
      onClose={onClose}
    >
      <div className="override-badges">
        {existing !== undefined && isAgentAuthored(existing) ? (
          <Badge tone="accent">Agent 生成</Badge>
        ) : null}
        {existing?.editedByUser === true ? <Badge tone="neutral">已由你编辑</Badge> : null}
        {existing === undefined ? <Badge tone="neutral">尚未保存</Badge> : null}
      </div>

      <TextAreaField
        label="文案"
        value={text}
        rows={7}
        disabled={frozen || busy}
        hint={`${count.toString()} / ${limit.toString()} 字`}
        error={tooLong ? `超出 ${limit.toString()} 字上限` : null}
        onChange={(event) => {
          setText(event.target.value)
          setError(null)
        }}
      />

      {error === null ? null : (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {existing === undefined || target.kind === 'summary' ? null : (
        <fieldset className="studio-fieldset override-library" disabled={frozen || busy}>
          <legend className="studio-legend">保存回信息库</legend>
          <p className="studio-hint">
            把这段改写写回条目字段；这是对共享信息的修改，其他简历也会看到。
          </p>
          {textareaFields.length === 0 ? (
            <p className="studio-hint">这个模块没有多行字段可写入。</p>
          ) : (
            <div className="override-library-row">
              <SelectField
                label="写入字段"
                value={libraryField}
                options={textareaFields.map((field) => ({
                  value: field.key,
                  label: field.label,
                }))}
                onChange={(event) => setLibraryField(event.target.value)}
              />
              <SegmentedControl
                label="写入方式"
                options={MODE_OPTIONS}
                value={libraryMode}
                onChange={setLibraryMode}
              />
              <Button
                variant="secondary"
                size="small"
                disabled={frozen || busy || libraryField === ''}
                onClick={() => {
                  void writeBack()
                }}
              >
                保存回信息库
              </Button>
            </div>
          )}
        </fieldset>
      )}

      {existing === undefined ? null : (
        <div className="override-danger">
          {confirmDelete ? (
            <div className="override-delete-confirm">
              <span>删除这段文案？条目原文会重新显示。</span>
              <Button
                variant="danger"
                size="small"
                disabled={busy}
                onClick={() => {
                  void remove()
                }}
              >
                确认删除
              </Button>
              <Button variant="ghost" size="small" onClick={() => setConfirmDelete(false)}>
                取消
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="small"
              disabled={frozen || busy}
              onClick={() => setConfirmDelete(true)}
            >
              删除这段文案
            </Button>
          )}
        </div>
      )}
    </Dialog>
  )
}
