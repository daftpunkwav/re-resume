/**
 * @file OverrideDialogSections
 * @description The three independent parts of the override dialog: its
 * provenance badges, the action that writes a rewrite back into the shared
 * library entry, and the two-step delete. Each owns the state and the failure
 * message for its own action, so the dialog itself only decides what to show.
 */

import { useState } from 'react'

import { fieldDescriptors } from '../../../domain/info/InfoFieldValue'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { ResumeOverride } from '../../../domain/resume/ResumeOverride'
import type { ResumeOverrideId } from '../../../domain/shared/branded-id'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { SegmentedControl } from '../../app/components/SegmentedControl'
import { SelectField } from '../../app/components/SelectField'
import { showToast } from '../../app/stores/toastStore'
import { isAgentAuthored } from './resumeFormat'
import { useResumeStore } from './resumeStore'

const MODE_OPTIONS = [
  { id: 'replace' as const, label: '替换字段' },
  { id: 'append' as const, label: '追加一行' },
]

export function ProvenanceBadges({ existing }: { readonly existing: ResumeOverride | undefined }) {
  return (
    <div className="override-badges">
      {existing !== undefined && isAgentAuthored(existing) ? (
        <Badge tone="accent">Agent 生成</Badge>
      ) : null}
      {existing?.editedByUser === true ? <Badge tone="neutral">已由你编辑</Badge> : null}
      {existing === undefined ? <Badge tone="neutral">尚未保存</Badge> : null}
    </div>
  )
}

export interface WriteBackToLibraryProps {
  readonly overrideId: ResumeOverrideId
  readonly entry: InfoEntry | null
  readonly customModule: CustomModuleDefinition | null
  readonly disabled: boolean
  readonly onDone: () => void
  readonly onError: (message: string) => void
}

/** Writes the rewrite into one textarea field of the source entry. */
export function WriteBackToLibrary({
  overrideId,
  entry,
  customModule,
  disabled,
  onDone,
  onError,
}: WriteBackToLibraryProps) {
  const saveOverrideToLibrary = useResumeStore((state) => state.saveOverrideToLibrary)
  const fields =
    entry === null
      ? []
      : fieldDescriptors(entry.moduleKind, customModule).filter(
          (field) => field.type === 'textarea',
        )
  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? '')
  const [mode, setMode] = useState<'replace' | 'append'>('replace')

  const writeBack = async (): Promise<void> => {
    const accepted = await saveOverrideToLibrary({
      overrideId,
      targetFieldKey: fieldKey,
      mode,
    })
    if (!accepted) {
      onError('没有保存回信息库，请重试。')
      return
    }
    showToast('success', '已保存回信息库')
    onDone()
  }

  return (
    <fieldset className="studio-fieldset override-library" disabled={disabled}>
      <legend className="studio-legend">保存回信息库</legend>
      <p className="studio-hint">
        把这段改写写回条目字段；这是对共享信息的修改，其他简历也会看到。
      </p>
      {fields.length === 0 ? (
        <p className="studio-hint">这个模块没有多行字段可写入。</p>
      ) : (
        <div className="override-library-row">
          <SelectField
            label="写入字段"
            value={fieldKey}
            options={fields.map((field) => ({ value: field.key, label: field.label }))}
            onChange={(event) => setFieldKey(event.target.value)}
          />
          <SegmentedControl label="写入方式" options={MODE_OPTIONS} value={mode} onChange={setMode} />
          <Button
            variant="secondary"
            size="small"
            disabled={disabled || fieldKey === ''}
            onClick={() => {
              void writeBack()
            }}
          >
            保存回信息库
          </Button>
        </div>
      )}
    </fieldset>
  )
}

export interface DeleteOverrideControlProps {
  readonly overrideId: ResumeOverrideId
  readonly disabled: boolean
  readonly onDone: () => void
  readonly onError: (message: string) => void
}

export function DeleteOverrideControl({
  overrideId,
  disabled,
  onDone,
  onError,
}: DeleteOverrideControlProps) {
  const deleteOverride = useResumeStore((state) => state.deleteOverride)
  const [confirming, setConfirming] = useState(false)

  const remove = async (): Promise<void> => {
    const accepted = await deleteOverride(overrideId)
    if (!accepted) {
      onError('删除没有完成，请重试。')
      return
    }
    showToast('success', '这段文案已删除')
    onDone()
  }

  if (!confirming) {
    return (
      <div className="override-danger">
        <Button variant="ghost" size="small" disabled={disabled} onClick={() => setConfirming(true)}>
          删除这段文案
        </Button>
      </div>
    )
  }
  return (
    <div className="override-danger">
      <div className="override-delete-confirm">
        <span>删除这段文案？条目原文会重新显示。</span>
        <Button
          variant="danger"
          size="small"
          disabled={disabled}
          onClick={() => {
            void remove()
          }}
        >
          确认删除
        </Button>
        <Button variant="ghost" size="small" onClick={() => setConfirming(false)}>
          取消
        </Button>
      </div>
    </div>
  )
}
