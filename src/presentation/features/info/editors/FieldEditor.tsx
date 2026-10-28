/**
 * @file FieldEditor
 * @description Renders one stored field as the control its declared type names.
 * Every module — built in and custom — goes through this dispatch, so a field
 * type added to the contract needs one editor here rather than one per module.
 *
 * Responsibilities:
 * - Map each `FieldType` to its control
 * - Show the character budget of a bounded field, counted in code points
 * - Keep the field's label, hint and error wiring identical across types
 *
 * Constraints:
 * - The value is the stored form; text is a string, a flag is a boolean, and an
 *   absent value is the empty string. Validation never happens here.
 */

import type { FieldDescriptor } from '../../../../domain/info/InfoFieldValue'
import { countCodePoints } from '../../../../domain/info/codePoints'
import { SelectField } from '../../../app/components/SelectField'
import { Switch } from '../../../app/components/Switch'
import { TextAreaField } from '../../../app/components/TextAreaField'
import { TextField } from '../../../app/components/TextField'
import { KnowledgeDateField } from './KnowledgeDateField'

type FieldDraftValue = string | boolean

export interface FieldEditorProps {
  readonly descriptor: FieldDescriptor
  readonly value: FieldDraftValue
  readonly error: string | null
  readonly onChange: (value: FieldDraftValue) => void
}

/** How many rows a textarea opens with, from the declared length. */
function textareaRows(maxLength: number | null): number {
  if (maxLength === null) return 3
  if (maxLength <= 400) return 3
  if (maxLength <= 1000) return 4
  return 5
}

function textOf(value: FieldDraftValue): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The label plus the character reading of a bounded field. The counter appears
 * once the budget is a third used or the field is a textarea, which is where a
 * reader benefits from it; the full hint is kept beside it when one exists.
 */
function fieldHint(descriptor: FieldDescriptor, text: string) {
  if (descriptor.maxLength === null) return descriptor.hint
  const length = countCodePoints(text)
  const maximum = descriptor.maxLength
  const visible = descriptor.type === 'textarea' || length >= maximum * 0.6
  const counter = visible ? (
    <span className={length > maximum ? 'info-counter info-counter-over' : 'info-counter'}>
      {length} / {maximum}
    </span>
  ) : null
  if (descriptor.hint === undefined) return counter
  return (
    <span className="info-field-meta">
      <span>{descriptor.hint}</span>
      {counter}
    </span>
  )
}

export function FieldEditor({ descriptor, value, error, onChange }: FieldEditorProps) {
  const label = descriptor.required ? `${descriptor.label} *` : descriptor.label
  switch (descriptor.type) {
    case 'textarea':
      return (
        <TextAreaField
          label={label}
          rows={textareaRows(descriptor.maxLength)}
          value={textOf(value)}
          hint={fieldHint(descriptor, textOf(value))}
          error={error}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'enum':
      return (
        <SelectField
          label={label}
          value={textOf(value)}
          options={[
            { value: '', label: descriptor.required ? '请选择' : '未选择' },
            ...(descriptor.options ?? []),
          ]}
          hint={descriptor.hint}
          error={error}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'bool':
      return (
        <div className="info-bool-field">
          <Switch
            label={label}
            checked={value === true}
            description={descriptor.hint}
            onChange={onChange}
          />
          {error === null ? null : (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )
    case 'date':
    case 'dateOrPresent':
      return (
        <KnowledgeDateField
          label={descriptor.label}
          value={textOf(value)}
          required={descriptor.required}
          allowPresent={descriptor.type === 'dateOrPresent'}
          error={error}
          onChange={onChange}
        />
      )
    case 'url':
    case 'email':
      return (
        <TextField
          label={label}
          type="text"
          inputMode={descriptor.type === 'url' ? 'url' : 'email'}
          autoComplete="off"
          spellCheck={false}
          placeholder={descriptor.type === 'url' ? 'https://' : 'name@example.com'}
          value={textOf(value)}
          hint={fieldHint(descriptor, textOf(value))}
          error={error}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'text':
      return (
        <TextField
          label={label}
          type="text"
          autoComplete="off"
          value={textOf(value)}
          hint={fieldHint(descriptor, textOf(value))}
          error={error}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}
