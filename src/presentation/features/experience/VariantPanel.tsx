/**
 * @file VariantPanel
 * @description The wordings of one experience and what is done to each. A
 * variant drafted by an agent run stays out of reach until the user confirms
 * it, so the row carries its state and the confirmation action sits next to the
 * text it applies to.
 *
 * Responsibilities:
 * - List the variants with an unconfirmed-draft badge and a one-line excerpt
 * - Create and rewrite a variant
 * - Confirm a variant and delete one behind a dialog that names the blockers
 *
 * Constraints:
 * - A variant carries no fact field, so nothing here may edit one. Rewording a
 *   description must not reach the facts it describes.
 * - Each row owns its own commands, so a failure is reported beside the control
 *   that failed rather than in a list-wide corner.
 */

import { useState } from 'react'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { EmptyState } from '../../app/components/EmptyState'
import { Notice } from '../../app/components/Notice'
import { TextAreaField } from '../../app/components/TextAreaField'
import { TextField } from '../../app/components/TextField'
import { useOperation } from '../../app/useOperation'
import type { ExperienceLibrary } from '../../../bootstrap/compositionRoot'
import type { Experience } from '../../../domain/catalog/Experience'
import { isUnconfirmedDraft } from '../../../domain/catalog/Variant'
import type { Variant } from '../../../domain/catalog/Variant'
import { describeCommandFailure } from './experienceKindLabels'

interface VariantDraft {
  readonly label: string
  readonly emphasis: string
  readonly content: string
}

const EMPTY_DRAFT: VariantDraft = { label: '', emphasis: '', content: '' }

/** First line only, so a long wording does not push the next row off screen. */
function excerptOf(variant: Variant): string {
  const [firstLine = ''] = variant.content.split('\n')
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine
}

function draftOf(variant: Variant | null): VariantDraft {
  return {
    label: variant?.label ?? '',
    emphasis: variant?.emphasis ?? '',
    content: variant?.content ?? '',
  }
}

interface VariantRowProps {
  readonly library: ExperienceLibrary
  readonly experience: Experience
  readonly variant: Variant
  readonly onEdit: (variant: Variant) => void
  readonly onChanged: (updated: Experience | null) => void | Promise<void>
}

function VariantRow({ library, experience, variant, onEdit, onChanged }: VariantRowProps) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)

  const confirm = useOperation(async () => {
    await onChanged(await library.confirmVariant(experience.id, variant.id))
  })

  const remove = useOperation(async () => {
    await library.removeVariant(experience.id, variant.id)
    await onChanged(null)
    setConfirmingRemoval(false)
  })

  const blockers = remove.error?.blockers ?? []

  return (
    <li className="experience-row">
      <div className="list-row-body">
        <div className="experience-row-head">
          <span className="list-row-title">{variant.label}</span>
          {isUnconfirmedDraft(variant) ? <Badge tone="warning">未确认</Badge> : null}
        </div>
        <p className="experience-excerpt">{excerptOf(variant)}</p>
        {variant.emphasis === null ? null : <p className="list-row-meta">{variant.emphasis}</p>}
      </div>
      <div className="experience-row-actions">
        <Button size="small" icon="edit" onClick={() => onEdit(variant)}>
          编辑
        </Button>
        {isUnconfirmedDraft(variant) ? (
          <Button
            size="small"
            icon="check"
            disabled={confirm.busy}
            onClick={() => void confirm.run()}
          >
            确认
          </Button>
        ) : null}
        <Button
          size="small"
          variant="danger"
          icon="trash"
          onClick={() => {
            remove.clearError()
            setConfirmingRemoval(true)
          }}
        >
          删除
        </Button>
      </div>
      {confirm.error === null ? null : <Notice tone="danger" title={confirm.error.message} />}

      <Dialog
        open={confirmingRemoval}
        title={`删除表述「${variant.label}」`}
        description="删除后这条表述将从经历库中移除。引用了它的简历块需要先改指向别的表述。"
        confirmLabel="删除"
        destructive
        busy={remove.busy}
        onConfirm={() => void remove.run()}
        onClose={() => setConfirmingRemoval(false)}
      >
        {remove.error === null ? null : (
          <Notice tone="danger" title={remove.error.message}>
            {blockers.length === 0 ? null : (
              <>
                <p>下列简历块仍然引用它：</p>
                <ul className="experience-blockers">
                  {blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </>
            )}
          </Notice>
        )}
      </Dialog>
    </li>
  )
}

export interface VariantPanelProps {
  readonly library: ExperienceLibrary
  readonly experience: Experience
  readonly onChanged: (updated: Experience | null) => void | Promise<void>
}

export function VariantPanel({ library, experience, onChanged }: VariantPanelProps) {
  const [editing, setEditing] = useState<{ readonly variant: Variant | null } | null>(null)
  const [draft, setDraft] = useState<VariantDraft>(EMPTY_DRAFT)

  const save = useOperation(async () => {
    if (editing === null) return
    const emphasis = draft.emphasis.trim() === '' ? null : draft.emphasis.trim()
    const result =
      editing.variant === null
        ? await library.addVariant({
            experienceId: experience.id,
            label: draft.label.trim(),
            content: draft.content.trim(),
            emphasis,
          })
        : await library.updateVariant({
            experienceId: experience.id,
            variantId: editing.variant.id,
            label: draft.label.trim(),
            content: draft.content.trim(),
            emphasis,
          })
    if (!result.ok) throw new Error(describeCommandFailure(result.error))
    await onChanged(result.value)
    setEditing(null)
  })

  const openEditor = (variant: Variant | null) => {
    save.clearError()
    setDraft(draftOf(variant))
    setEditing({ variant })
  }

  return (
    <div className="stack">
      <div className="toolbar experience-toolbar">
        <p className="experience-hint">
          表述只描述这条经历，不改动事实。Agent 起草的表述在确认前不能放进简历。
        </p>
        <div className="toolbar-group">
          <Button size="small" icon="plus" disabled={editing !== null} onClick={() => openEditor(null)}>
            新建表述
          </Button>
        </div>
      </div>

      {editing === null ? null : (
        <div className="stack experience-editor">
          <TextField
            label="表述名称"
            hint="同一经历下唯一，例如「架构导向」"
            value={draft.label}
            onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
          />
          <TextField
            label="表达重点"
            hint="可选，说明这条表述偏向什么"
            value={draft.emphasis}
            onChange={(event) =>
              setDraft((current) => ({ ...current, emphasis: event.target.value }))
            }
          />
          <TextAreaField
            label="表述内容"
            rows={6}
            value={draft.content}
            onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
          />
          {save.error === null ? null : <Notice tone="danger" title={save.error.message} />}
          <div className="experience-form-actions">
            <Button
              variant="ghost"
              disabled={save.busy}
              onClick={() => {
                save.clearError()
                setEditing(null)
              }}
            >
              取消
            </Button>
            <Button variant="primary" disabled={save.busy} onClick={() => void save.run()}>
              {editing.variant === null ? '创建表述' : '保存表述'}
            </Button>
          </div>
        </div>
      )}

      {experience.variants.length === 0 ? (
        <EmptyState
          icon="edit"
          title="还没有表述"
          description="为同一条经历写几种面向不同岗位的说法，每份简历各取所需。"
        />
      ) : (
        <ul className="experience-rows">
          {experience.variants.map((variant) => (
            <VariantRow
              key={variant.id}
              library={library}
              experience={experience}
              variant={variant}
              onEdit={openEditor}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
