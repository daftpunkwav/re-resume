/**
 * @file CustomModuleDialog
 * @description The authoring surface of a custom module: name it, declare up to
 * twelve fields with a type, a required flag and a length bound, order them and
 * remove them. A stored field keeps its identity for life, so only its label
 * may change; removing one asks again when stored values would be cleared.
 *
 * Responsibilities:
 * - Validate the shape a user can see before the use case runs (name text,
 *   field label bounds, length bounds)
 * - Ask for confirmation before a removal that clears stored values, then
 *   retry the update with that confirmation
 * - Keep the create and edit forms one surface
 *
 * Constraints:
 * - Rules are the domain's: bounds come from `CustomModule`, the name is
 *   normalised by the domain function, and the library-wide uniqueness answer
 *   is still enforced by the refusing use case.
 * - The dialog is two shared Dialog states, not a nested modal: asking about a
 *   value loss must not stack a second focus trap on the first.
 */

import { useState } from 'react'
import type { CustomFieldUpdate } from '../../../application/info/updateCustomModule'
import type {
  CustomFieldType,
  CustomModuleDefinition,
} from '../../../domain/info/CustomModule'
import {
  CUSTOM_FIELD_COUNT_MAX,
  CUSTOM_FIELD_COUNT_MIN,
  CUSTOM_MODULE_NAME_MAX_LENGTH,
} from '../../../domain/info/CustomModule'
import { countCodePoints } from '../../../domain/info/codePoints'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { CustomModuleId } from '../../../domain/shared/branded-id'
import { describeError } from '../../app/errorMessages'
import type { ReadableError } from '../../app/errorMessages'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { Notice } from '../../app/components/Notice'
import { TextField } from '../../app/components/TextField'
import { CustomModuleFieldRow } from './CustomModuleFieldRow'
import {
  draftFieldsOf,
  nameTaken,
  newFieldDraft,
  readModuleName,
  validateFieldDrafts,
} from './customModuleDraft'
import type {
  CustomModuleFieldDraft,
  CustomModuleFieldError,
} from './customModuleDraft'

export interface CustomModuleNewField {
  readonly label: string
  readonly type: CustomFieldType
  readonly required: boolean
  readonly maxLength: number
}

export interface CustomModuleDialogProps {
  /** The definition being edited, or null when creating one. */
  readonly module: CustomModuleDefinition | null
  /** The entries the module currently holds; used to size a value loss. */
  readonly entriesOfModule: readonly InfoEntry[]
  readonly existingModules: readonly CustomModuleDefinition[]
  readonly onClose: () => void
  readonly onCreate: (input: {
    readonly name: string
    readonly fields: readonly CustomModuleNewField[]
  }) => Promise<CustomModuleDefinition>
  readonly onUpdate: (input: {
    readonly moduleId: CustomModuleId
    readonly name?: string
    readonly fields?: readonly CustomFieldUpdate[]
    readonly confirmValuesLoss?: boolean
  }) => Promise<{ readonly module: CustomModuleDefinition }>
  readonly onRequestDelete: (module: CustomModuleDefinition) => void
  readonly onSaved: (module: CustomModuleDefinition) => void
}

/** How many entries would have a stored value cleared by removing these keys. */
function affectedEntries(
  entries: readonly InfoEntry[],
  removedKeys: ReadonlySet<string>,
): number {
  return entries.filter((entry) =>
    [...removedKeys].some((key) => {
      const value = entry.fields[key]
      return typeof value === 'string' && value !== ''
    }),
  ).length
}

interface LossPrompt {
  readonly removedLabels: readonly string[]
  readonly affectedCount: number
}

export function CustomModuleDialog({
  module,
  entriesOfModule,
  existingModules,
  onClose,
  onCreate,
  onUpdate,
  onRequestDelete,
  onSaved,
}: CustomModuleDialogProps) {
  const [name, setName] = useState(module?.name ?? '')
  const [fields, setFields] = useState<readonly CustomModuleFieldDraft[]>(() =>
    draftFieldsOf(module),
  )
  const [nameError, setNameError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<number, CustomModuleFieldError>>
  >({})
  const [formError, setFormError] = useState<ReadableError | null>(null)
  const [saving, setSaving] = useState(false)
  const [lossPrompt, setLossPrompt] = useState<LossPrompt | null>(null)

  const creating = module === null
  const title = creating ? '新建自定义模块' : `编辑「${module.name}」`

  const updateField = (index: number, patch: Partial<CustomModuleFieldDraft>): void => {
    setFields((current) =>
      current.map((field, at) => (at === index ? { ...field, ...patch } : field)),
    )
    setFieldErrors((current) => {
      if (current[index] === undefined) return current
      const next = { ...current }
      delete next[index]
      return next
    })
  }

  const moveField = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= fields.length) return
    setFields((current) => {
      const next = [...current]
      const moved = next[index]
      const replaced = next[target]
      if (moved === undefined || replaced === undefined) return current
      next[index] = replaced
      next[target] = moved
      return next
    })
  }

  const removeField = (index: number): void => {
    if (fields.length <= CUSTOM_FIELD_COUNT_MIN) return
    setFields((current) => current.filter((_, at) => at !== index))
    setFieldErrors({})
  }

  const addField = (): void => {
    if (fields.length >= CUSTOM_FIELD_COUNT_MAX) return
    setFields((current) => [...current, newFieldDraft()])
  }

  const submit = async (confirmValuesLoss: boolean): Promise<void> => {
    const read = readModuleName(name)
    if (read.name === undefined) {
      setNameError(read.error ?? '模块名称不合法。')
      return
    }
    setNameError(null)
    if (nameTaken(read.name, existingModules, module?.id ?? null)) {
      setNameError('已经有同名的模块，请换一个名称。')
      return
    }
    const errors = validateFieldDrafts(fields)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    if (!creating && !confirmValuesLoss) {
      const removed = module.fields.filter(
        (field) => !fields.some((draft) => draft.key === field.key),
      )
      const affected = affectedEntries(
        entriesOfModule,
        new Set(removed.map((field) => field.key)),
      )
      if (affected > 0) {
        setLossPrompt({
          removedLabels: removed.map((field) => field.label),
          affectedCount: affected,
        })
        return
      }
    }

    const fieldInput = (field: CustomModuleFieldDraft): CustomModuleNewField => ({
      label: field.label.trim(),
      type: field.type,
      required: field.required,
      maxLength: field.maxLength,
    })
    setSaving(true)
    setFormError(null)
    try {
      if (creating) {
        const created = await onCreate({ name: read.name, fields: fields.map(fieldInput) })
        onSaved(created)
        return
      }
      const updatedFields: readonly CustomFieldUpdate[] = fields.map((field) =>
        field.key === null ? fieldInput(field) : { key: field.key, ...fieldInput(field) },
      )
      const updated = await onUpdate({
        moduleId: module.id,
        name: read.name,
        fields: updatedFields,
        ...(confirmValuesLoss ? { confirmValuesLoss: true } : {}),
      })
      onSaved(updated.module)
    } catch (thrown) {
      setFormError(describeError(thrown))
      setLossPrompt(null)
    } finally {
      setSaving(false)
    }
  }

  const lossMode = lossPrompt !== null
  return (
    <Dialog
      open
      title={lossMode ? '删除字段会清除已填写的内容' : title}
      description={lossMode ? undefined : '一个模块最多 12 个字段。已保存的字段只能修改名称。'}
      confirmLabel={lossMode ? '清除并保存' : creating ? '创建模块' : '保存'}
      cancelLabel={lossMode ? '返回' : '取消'}
      destructive={lossMode}
      busy={saving}
      onConfirm={() => {
        void submit(lossMode)
      }}
      onClose={() => {
        if (lossMode) {
          setLossPrompt(null)
          return
        }
        onClose()
      }}
    >
      {lossMode && lossPrompt !== null ? (
        <>
          <p className="dialog-description">
            移除「{lossPrompt.removedLabels.join('」「')}」会清除{' '}
            {lossPrompt.affectedCount.toString()} 条信息中这些字段的内容，且无法恢复。
          </p>
          <p className="info-dialog-note">如果只是想修改名称，请返回后保留这些字段。</p>
        </>
      ) : (
        <>
          {formError === null ? null : (
            <Notice tone="danger" title="没有保存成功">
              <p>{formError.message}</p>
            </Notice>
          )}
          <div className="info-module-form">
            <TextField
              label="模块名称 *"
              value={name}
              autoComplete="off"
              maxLength={CUSTOM_MODULE_NAME_MAX_LENGTH}
              hint={`${countCodePoints(name.trim()).toString()} / ${String(CUSTOM_MODULE_NAME_MAX_LENGTH)}`}
              error={nameError}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
              }}
            />
            <div className="info-module-fields-head">
              <span className="info-module-fields-title">
                字段 {fields.length.toString()} / {CUSTOM_FIELD_COUNT_MAX.toString()}
              </span>
              <Button
                size="small"
                variant="ghost"
                icon="plus"
                disabled={fields.length >= CUSTOM_FIELD_COUNT_MAX}
                onClick={addField}
              >
                添加字段
              </Button>
            </div>
            <ul className="info-module-fields">
              {fields.map((field, index) => (
                <CustomModuleFieldRow
                  key={field.key ?? `new-${String(index)}`}
                  index={index}
                  total={fields.length}
                  field={field}
                  error={fieldErrors[index]}
                  canRemove={fields.length > CUSTOM_FIELD_COUNT_MIN}
                  onChange={(patch) => updateField(index, patch)}
                  onMove={(direction) => moveField(index, direction)}
                  onRemove={() => removeField(index)}
                />
              ))}
            </ul>
            {module === null ? null : (
              <div className="info-module-danger">
                <Button
                  variant="ghost"
                  size="small"
                  className="info-danger-button"
                  onClick={() => onRequestDelete(module)}
                >
                  删除这个模块…
                </Button>
                <span>会一并删除模块内的条目。</span>
              </div>
            )}
          </div>
        </>
      )}
    </Dialog>
  )
}
