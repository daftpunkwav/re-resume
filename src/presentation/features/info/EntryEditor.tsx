/**
 * @file EntryEditor
 * @description The form of one library entry: the module's declared fields,
 * rendered by type, validated through the domain validator before the write.
 * It owns the draft and its dirty state; navigation away from a dirty draft is
 * the panel's decision, which is why the draft can be inspected and saved
 * through the imperative handle.
 *
 * Responsibilities:
 * - Initialize the draft from the stored entry (or empty for a new one)
 * - Map a refused field to the control that produced it
 * - Save through the caller's use case and reset the baseline on success
 *
 * Constraints:
 * - Validation is `validateFieldValues`, the same function the use case runs;
 *   no rule is restated in this component.
 * - The entry identity is the remount key: a different entry or a fresh create
 *   form is a new component, so no effect has to synchronise a draft.
 */

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { FieldDescriptor, InfoFieldValue } from '../../../domain/info/InfoFieldValue'
import { fieldDescriptors } from '../../../domain/info/InfoFieldValue'
import { validateFieldValues } from '../../../domain/info/InfoFieldValue'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { InfoModuleKind } from '../../../domain/info/InfoModuleKind'
import { moduleDescriptor } from '../../../domain/info/InfoModuleKind'
import type { InfoEntryId } from '../../../domain/shared/branded-id'
import { describeError } from '../../app/errorMessages'
import type { ReadableError } from '../../app/errorMessages'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { IconButton } from '../../app/components/IconButton'
import { Notice } from '../../app/components/Notice'
import { fieldViolationFor } from './infoErrors'
import type { AgentTouchKind } from './stores/infoStore'
import { FieldEditor } from './editors/FieldEditor'

export interface EntryEditorHandle {
  isDirty(): boolean
  /** Saves the draft; false means the form still holds a refusal to show. */
  save(): Promise<boolean>
  /** Throws the draft away and returns to the stored values. */
  discard(): void
}

/** The form's working copy: text for every field, a flag for a boolean field. */
type EntryDraft = Readonly<Record<string, string | boolean>>

export interface EntryEditorProps {
  readonly moduleKind: InfoModuleKind
  readonly customModule: CustomModuleDefinition | null
  /** The stored entry, or null for a create form. */
  readonly entry: InfoEntry | null
  readonly agentTouch: AgentTouchKind | null
  readonly onSaved: (entry: InfoEntry, created: boolean) => void
  readonly onCancel: () => void
  /** Shows the back-to-list affordance in the single-column layout. */
  readonly onBack?: () => void
  readonly onRequestDelete: (entry: InfoEntry) => void
  readonly onAddToConversation?: (entry: InfoEntry) => void
  readonly onCreate: (fields: Readonly<Record<string, unknown>>) => Promise<InfoEntry>
  readonly onUpdate: (
    entryId: InfoEntryId,
    fields: Readonly<Record<string, unknown>>,
  ) => Promise<InfoEntry>
}

function draftValueOf(value: InfoFieldValue | undefined, booleanField: boolean): string | boolean {
  if (booleanField) return value === true
  return typeof value === 'string' ? value : ''
}

function draftFor(
  descriptors: readonly FieldDescriptor[],
  entry: InfoEntry | null,
): EntryDraft {
  const draft: Record<string, string | boolean> = {}
  for (const descriptor of descriptors) {
    draft[descriptor.key] = draftValueOf(entry?.fields[descriptor.key], descriptor.type === 'bool')
  }
  return draft
}

function isDraftDirty(draft: EntryDraft, baseline: EntryDraft): boolean {
  return Object.keys(baseline).some((key) => draft[key] !== baseline[key])
}

/**
 * The record the domain validator receives: text stays text, flags stay flags,
 * and an empty optional field is omitted rather than sent as an empty string —
 * the validator accepts an absent optional value and rejects an empty text
 * value as malformed.
 */
function rawFieldsOf(
  draft: EntryDraft,
  descriptors: readonly FieldDescriptor[],
): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  for (const descriptor of descriptors) {
    const value = draft[descriptor.key]
    if (typeof value === 'boolean') {
      raw[descriptor.key] = value
      continue
    }
    if ((value ?? '') === '' && !descriptor.required) continue
    raw[descriptor.key] = value ?? ''
  }
  return raw
}

function originLabel(origin: InfoEntry['origin']): string {
  return origin === 'agent' ? '由 Agent 写入' : '手动录入'
}

function touchLabel(kind: AgentTouchKind): string {
  return kind === 'created' ? '新增' : '已更新'
}

interface SingleGroup {
  readonly kind: 'single'
  readonly descriptor: FieldDescriptor
}

interface PairGroup {
  readonly kind: 'pair'
  readonly start: FieldDescriptor
  readonly end: FieldDescriptor
}

type FieldGroup = SingleGroup | PairGroup

/** The start/end pair rendered side by side when the module declares both. */
function fieldGroups(descriptors: readonly FieldDescriptor[]): readonly FieldGroup[] {
  const start = descriptors.find((descriptor) => descriptor.key === 'startDate')
  const end = descriptors.find((descriptor) => descriptor.key === 'endDate')
  const groups: FieldGroup[] = []
  for (const descriptor of descriptors) {
    if (start !== undefined && end !== undefined) {
      if (descriptor.key === 'endDate') continue
      if (descriptor.key === 'startDate') {
        groups.push({ kind: 'pair', start, end })
        continue
      }
    }
    groups.push({ kind: 'single', descriptor })
  }
  return groups
}

export const EntryEditor = forwardRef<EntryEditorHandle, EntryEditorProps>(function EntryEditor(
  {
    moduleKind,
    customModule,
    entry,
    agentTouch,
    onSaved,
    onCancel,
    onBack,
    onRequestDelete,
    onAddToConversation,
    onCreate,
    onUpdate,
  },
  ref,
) {
  const descriptors = useMemo(
    () => fieldDescriptors(moduleKind, customModule),
    [moduleKind, customModule],
  )
  const label = moduleDescriptor(moduleKind, customModule).label
  const groups = useMemo(() => fieldGroups(descriptors), [descriptors])

  const [baseline, setBaseline] = useState<EntryDraft>(() => draftFor(descriptors, entry))
  const [draft, setDraft] = useState<EntryDraft>(baseline)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [formError, setFormError] = useState<ReadableError | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty = isDraftDirty(draft, baseline)

  const applyFieldError = useCallback(
    (thrown: unknown): boolean => {
      const violation = fieldViolationFor(thrown, descriptors)
      if (violation === null) return false
      setFieldErrors(
        violation.fieldKey === null ? {} : { [violation.fieldKey]: violation.message },
      )
      setFormError(null)
      return true
    },
    [descriptors],
  )

  const save = useCallback(async (): Promise<boolean> => {
    const raw = rawFieldsOf(draft, descriptors)
    try {
      validateFieldValues(moduleKind, customModule, raw)
    } catch (thrown) {
      if (!applyFieldError(thrown)) setFormError(describeError(thrown))
      return false
    }
    setSaving(true)
    setFieldErrors({})
    setFormError(null)
    try {
      const saved = entry === null ? await onCreate(raw) : await onUpdate(entry.id, raw)
      const nextBaseline = draftFor(descriptors, saved)
      setBaseline(nextBaseline)
      // Text typed while the write was in flight belongs to the reader, not to
      // the response: keep it, and leave the form dirty against the stored value.
      setDraft((current) => (current === draft ? nextBaseline : current))
      onSaved(saved, entry === null)
      return true
    } catch (thrown) {
      if (!applyFieldError(thrown)) setFormError(describeError(thrown))
      return false
    } finally {
      setSaving(false)
    }
  }, [
    applyFieldError,
    customModule,
    descriptors,
    draft,
    entry,
    moduleKind,
    onCreate,
    onSaved,
    onUpdate,
  ])

  const discard = useCallback(() => {
    setDraft(baseline)
    setFieldErrors({})
    setFormError(null)
  }, [baseline])

  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const saveRef = useRef(save)
  saveRef.current = save
  const discardRef = useRef(discard)
  discardRef.current = discard

  useImperativeHandle(
    ref,
    () => ({
      isDirty: () => dirtyRef.current,
      save: () => saveRef.current(),
      discard: () => discardRef.current(),
    }),
    [],
  )

  const setField = (key: string, value: string | boolean): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      if (current[key] === undefined) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const renderField = (descriptor: FieldDescriptor): ReactNode => (
    <FieldEditor
      key={descriptor.key}
      descriptor={descriptor}
      value={draft[descriptor.key] ?? (descriptor.type === 'bool' ? false : '')}
      error={fieldErrors[descriptor.key] ?? null}
      onChange={(value) => setField(descriptor.key, value)}
    />
  )

  const heading = entry === null ? `新建${label}` : entry.title
  const status = dirty ? '有未保存的修改' : entry === null ? '尚未添加' : '已保存'

  return (
    <section className="info-editor" aria-label={entry === null ? `新建${label}` : `编辑${label}`}>
      <header className="info-editor-head">
        {onBack === undefined ? null : (
          <IconButton
            icon="chevrons-left"
            label="返回条目列表"
            size="small"
            className="info-editor-back"
            onClick={onBack}
          />
        )}
        <div className="info-editor-heading">
          <h3 className="info-editor-title" title={heading}>
            {heading}
          </h3>
          <p className="info-editor-meta">
            <span>{entry === null ? '填写后添加' : originLabel(entry.origin)}</span>
            {agentTouch === null ? null : <Badge tone="accent">{touchLabel(agentTouch)}</Badge>}
          </p>
        </div>
        <div className="info-editor-actions">
          {entry !== null && onAddToConversation !== undefined ? (
            <IconButton
              icon="message-square"
              label="加入对话"
              size="small"
              onClick={() => onAddToConversation(entry)}
            />
          ) : null}
          {entry === null ? null : (
            <IconButton
              icon="close"
              label="删除这条信息"
              size="small"
              onClick={() => onRequestDelete(entry)}
            />
          )}
        </div>
      </header>

      <div className="info-editor-scroll">
        {formError === null ? null : (
          <Notice tone="danger" title="没有保存成功">
            <p>{formError.message}</p>
            {formError.blockers.length === 0 ? null : (
              <p className="info-blockers">{formError.blockers.join('、')}</p>
            )}
          </Notice>
        )}
        <div className="info-form">
          {groups.map((group) => {
            if (group.kind === 'single') return renderField(group.descriptor)
            return (
              <div className="info-field-row" key={`pair-${group.start.key}`}>
                {renderField(group.start)}
                {renderField(group.end)}
              </div>
            )
          })}
        </div>
      </div>

      <footer className="info-editor-foot">
        <span
          className={dirty ? 'info-editor-status info-editor-status-dirty' : 'info-editor-status'}
        >
          {status}
        </span>
        <div className="info-editor-foot-actions">
          <Button size="small" variant="ghost" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button
            size="small"
            variant="primary"
            loading={saving}
            disabled={!dirty && entry !== null}
            onClick={() => {
              void save()
            }}
          >
            {entry === null ? '添加' : '保存'}
          </Button>
        </div>
      </footer>
    </section>
  )
})
