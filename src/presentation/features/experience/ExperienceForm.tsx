/**
 * @file ExperienceForm
 * @description Editor for the fact fields of one experience, in both the edit
 * and the create case. The kind-specific fields are not written here: they are
 * read from the Zod schema the kind selects, so a kind that gains a field shows
 * up in the form without this file changing.
 *
 * Responsibilities:
 * - Render the shared fact fields and the detail fields of the chosen kind
 * - Turn the filled form into a CreateExperience or UpdateExperienceFact command
 * - Report a refused command through useOperation
 *
 * Constraints:
 * - The form holds no business rule. Date and title invariants belong to the
 *   aggregate, so a violation comes back as a failed result and is shown, not
 *   pre-empted here.
 * - Variant and claim editing has no path from this component.
 */

import { useState } from 'react'
import { z } from 'zod'
import { Button } from '../../app/components/Button'
import { Notice } from '../../app/components/Notice'
import { SelectField } from '../../app/components/SelectField'
import type { SelectOption } from '../../app/components/SelectField'
import { TextAreaField } from '../../app/components/TextAreaField'
import { TextField } from '../../app/components/TextField'
import { useOperation } from '../../app/useOperation'
import { EXPERIENCE_DETAIL_SCHEMAS } from '../../../application/catalog/experienceDetailSchemas'
import type { CreateExperienceCommand, ExperienceLibrary } from '../../../bootstrap/compositionRoot'
import type { UpdateExperienceFactCommand } from '../../../bootstrap/compositionRoot'
import { EXPERIENCE_KINDS } from '../../../domain/catalog/ExperienceKind'
import type { ExperienceKind } from '../../../domain/catalog/ExperienceKind'
import type { Experience } from '../../../domain/catalog/Experience'
import { describeCommandFailure, describeFieldName, EXPERIENCE_KIND_LABELS } from './experienceKindLabels'

/** The kind a brand new experience starts on until the user picks another. */
const INITIAL_KIND: ExperienceKind = 'work'

const KIND_OPTIONS: readonly SelectOption[] = EXPERIENCE_KINDS.map((kind) => ({
  value: kind,
  label: EXPERIENCE_KIND_LABELS[kind],
}))

interface DetailField {
  readonly name: string
  readonly label: string
  readonly multiline: boolean
  readonly optional: boolean
}

/**
 * The schema is the field list. `EXPERIENCE_DETAIL_SCHEMAS` is declared as a
 * record of ZodType so a missing kind fails to compile, which hides the object
 * shape; the cast restores the object API the form reads.
 */
function detailFieldsOf(kind: ExperienceKind): readonly DetailField[] {
  const schema = EXPERIENCE_DETAIL_SCHEMAS[kind] as z.ZodObject<{ [key: string]: z.ZodType }>
  return Object.entries(schema.shape).map(([name, field]) => {
    const optional = field.isOptional()
    const inner = field instanceof z.ZodOptional ? field.unwrap() : field
    return {
      name,
      label: describeFieldName(name),
      multiline: inner instanceof z.ZodArray,
      optional,
    }
  })
}

type DetailValues = Readonly<Record<string, string | readonly string[]>>

interface ExperienceDraft {
  readonly kind: ExperienceKind
  readonly title: string
  readonly organization: string
  readonly startDate: string
  readonly endDate: string
  readonly isCurrent: boolean
  readonly detail: DetailValues
}

function readDetailValue(raw: unknown): string | readonly string[] {
  if (Array.isArray(raw)) return raw.map((entry) => String(entry))
  return typeof raw === 'string' ? raw : ''
}

function detailValuesOf(experience: Experience | null, fields: readonly DetailField[]): DetailValues {
  const values: Record<string, string | readonly string[]> = {}
  for (const field of fields) {
    values[field.name] = readDetailValue(experience?.detail[field.name])
  }
  return values
}

function draftOf(experience: Experience | null, kind: ExperienceKind): ExperienceDraft {
  return {
    kind,
    title: experience?.title ?? '',
    organization: experience?.organization ?? '',
    startDate: experience?.startDate ?? '',
    endDate: experience?.endDate ?? '',
    isCurrent: experience?.isCurrent ?? false,
    detail: detailValuesOf(experience, detailFieldsOf(kind)),
  }
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function listValueOf(value: string | readonly string[] | undefined): readonly string[] {
  return typeof value === 'string' || value === undefined ? [] : value
}

/**
 * A required field is always sent, empty included, so the schema reports what
 * is missing. An optional field left blank is left out, because the schemas
 * reject a present but empty value and the aggregate stores an absent field as
 * absent rather than as "".
 */
function detailRecordOf(
  fields: readonly DetailField[],
  values: DetailValues,
): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const field of fields) {
    const value = values[field.name]
    if (field.multiline) {
      const entries = listValueOf(value)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
      if (field.optional && entries.length === 0) continue
      record[field.name] = entries
      continue
    }
    const text = typeof value === 'string' ? value.trim() : ''
    if (field.optional && text === '') continue
    record[field.name] = text
  }
  return record
}

export interface ExperienceFormProps {
  readonly library: ExperienceLibrary
  /** Null opens the form empty and creates a new experience on save. */
  readonly experience: Experience | null
  readonly onSaved: (saved: Experience) => void | Promise<void>
  readonly onListChanged: () => void | Promise<void>
}

export function ExperienceForm({
  library,
  experience,
  onSaved,
  onListChanged,
}: ExperienceFormProps) {
  const [draft, setDraft] = useState<ExperienceDraft>(() => draftOf(experience, experience?.kind ?? INITIAL_KIND))
  const fields = detailFieldsOf(draft.kind)

  const save = useOperation(async () => {
    const detail = detailRecordOf(fields, draft.detail)
    const facts = {
      title: draft.title.trim(),
      organization: trimmedOrNull(draft.organization),
      startDate: trimmedOrNull(draft.startDate),
      // The aggregate refuses a current experience that carries an end date, so
      // the two controls cannot both be in play.
      endDate: draft.isCurrent ? null : trimmedOrNull(draft.endDate),
      isCurrent: draft.isCurrent,
      detail,
    }
    const result =
      experience === null
        ? await library.create({ kind: draft.kind, ...facts } satisfies CreateExperienceCommand)
        : await library.updateFact({
            experienceId: experience.id,
            ...facts,
          } satisfies UpdateExperienceFactCommand)
    if (!result.ok) throw new Error(describeCommandFailure(result.error))
    await onSaved(result.value)
  }, onListChanged)

  const setFact = <Key extends keyof ExperienceDraft>(key: Key, value: ExperienceDraft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const setDetailValue = (name: string, value: string | readonly string[]) =>
    setDraft((current) => ({ ...current, detail: { ...current.detail, [name]: value } }))

  const changeKind = (kind: ExperienceKind) =>
    setDraft((current) => ({
      ...current,
      kind,
      // A detail field only means what the new kind's schema says it means, so
      // the values of the previous kind are dropped rather than carried over.
      detail: detailValuesOf(null, detailFieldsOf(kind)),
    }))

  return (
    <div className="stack">
      <div className="form-grid">
        <SelectField
          label="经历类型"
          options={KIND_OPTIONS}
          value={draft.kind}
          disabled={experience !== null}
          hint={experience === null ? undefined : '已有经历不能更换类型'}
          onChange={(event) => changeKind(event.target.value as ExperienceKind)}
        />
        <TextField
          label="标题"
          value={draft.title}
          onChange={(event) => setFact('title', event.target.value)}
        />
        <TextField
          label="单位"
          value={draft.organization}
          placeholder="学校、公司或机构"
          onChange={(event) => setFact('organization', event.target.value)}
        />
        <TextField
          label="开始日期"
          type="date"
          value={draft.startDate}
          onChange={(event) => setFact('startDate', event.target.value)}
        />
        <label className="field">
          <input
            type="checkbox"
            className="experience-checkbox"
            checked={draft.isCurrent}
            onChange={(event) => setFact('isCurrent', event.target.checked)}
          />
          <span className="field-label">至今</span>
        </label>
        <TextField
          label="结束日期"
          type="date"
          value={draft.isCurrent ? '' : draft.endDate}
          disabled={draft.isCurrent}
          hint={draft.isCurrent ? '标记为至今时不填写结束日期' : undefined}
          onChange={(event) => setFact('endDate', event.target.value)}
        />
      </div>

      <div className="form-grid">
        {fields.map((field) =>
          field.multiline ? (
            <TextAreaField
              key={field.name}
              className="form-grid-wide"
              label={field.label}
              hint="每行一条"
              value={listValueOf(draft.detail[field.name]).join('\n')}
              onChange={(event) =>
                setDetailValue(
                  field.name,
                  event.target.value.split('\n'),
                )
              }
            />
          ) : (
            <TextField
              key={field.name}
              label={field.label}
              value={typeof draft.detail[field.name] === 'string' ? draft.detail[field.name] : ''}
              onChange={(event) => setDetailValue(field.name, event.target.value)}
            />
          ),
        )}
      </div>

      {save.error === null ? null : (
        <Notice tone="danger" title={save.error.message}>
          {save.error.blockers.length === 0 ? null : (
            <ul className="experience-blockers">
              {save.error.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      <div className="experience-form-actions">
        <Button
          variant="ghost"
          disabled={save.busy}
          onClick={() => {
            save.clearError()
            setDraft(draftOf(experience, experience?.kind ?? INITIAL_KIND))
          }}
        >
          重置
        </Button>
        <Button variant="primary" disabled={save.busy} onClick={() => void save.run()}>
          {experience === null ? '创建经历' : '保存修改'}
        </Button>
      </div>
    </div>
  )
}
