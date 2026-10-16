/**
 * @file PageSetupForm
 * @description Paper and margin fields for one resume. Every field reports a
 * whole PageSetup through onChange; deciding what that change means — a
 * revision, a refusal — belongs to the editor.
 *
 * Constraints:
 * - Points are the unit throughout, and a field that does not hold a positive
 *   number is refused at the boundary instead of being written through.
 */

import { useState } from 'react'

import { Panel } from '../../app/components/Panel'
import { SelectField } from '../../app/components/SelectField'
import { TextField } from '../../app/components/TextField'
import type { PageSetup } from '../../../domain/resume/PageSetup'

export interface PageSetupFormProps {
  readonly pageSetup: PageSetup
  readonly disabled: boolean
  readonly onChange: (pageSetup: PageSetup) => void
}

type PointField = 'pageWidth' | 'pageHeight' | 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft'

const POINT_FIELDS: readonly { readonly field: PointField; readonly label: string }[] = [
  { field: 'pageWidth', label: '页面宽度（pt）' },
  { field: 'pageHeight', label: '页面高度（pt）' },
  { field: 'marginTop', label: '上边距（pt）' },
  { field: 'marginRight', label: '右边距（pt）' },
  { field: 'marginBottom', label: '下边距（pt）' },
  { field: 'marginLeft', label: '左边距（pt）' },
]

const COLUMN_OPTIONS = [
  { value: '1', label: '单栏' },
  { value: '2', label: '双栏' },
]

const INVALID_POINT = '请输入大于 0 的数字。'

function isPoint(raw: string): boolean {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0
}

function mark(
  fields: ReadonlySet<PointField>,
  field: PointField,
  valid: boolean,
): ReadonlySet<PointField> {
  const next = new Set(fields)
  if (valid) next.delete(field)
  else next.add(field)
  return next
}

function rawPoints(pageSetup: PageSetup): Readonly<Record<PointField, string>> {
  return {
    pageWidth: String(pageSetup.pageWidth),
    pageHeight: String(pageSetup.pageHeight),
    marginTop: String(pageSetup.marginTop),
    marginRight: String(pageSetup.marginRight),
    marginBottom: String(pageSetup.marginBottom),
    marginLeft: String(pageSetup.marginLeft),
  }
}

export function PageSetupForm({ pageSetup, disabled, onChange }: PageSetupFormProps) {
  // The draft follows the stored setup, so the committed value always wins
  // once a revision comes back — including one an undo has just rolled back.
  // Adjusting it while rendering, rather than in an effect, keeps the field
  // from showing a value for a render that the store has already replaced.
  const [draft, setDraft] = useState<PageSetup>(pageSetup)
  const [draftedFrom, setDraftedFrom] = useState<PageSetup>(pageSetup)
  // What each field shows is what the user has typed, which is not always a
  // number: a half-typed 620 reads as 6 or 62, and clearing a field reads as
  // nothing at all. Reporting any of those as a change would write a revision
  // per keystroke, so the draft only moves once the edit is finished.
  const [typed, setTyped] = useState<Readonly<Record<PointField, string>>>(rawPoints(pageSetup))
  const [invalid, setInvalid] = useState<ReadonlySet<PointField>>(new Set())

  if (draftedFrom !== pageSetup) {
    setDraftedFrom(pageSetup)
    setDraft(pageSetup)
    setTyped(rawPoints(pageSetup))
    setInvalid(new Set())
  }

  const readPoint = (field: PointField, raw: string): void => {
    setTyped((previous) => ({ ...previous, [field]: raw }))
    setInvalid((previous) => mark(previous, field, isPoint(raw)))
  }

  const commitPoint = (field: PointField): void => {
    const raw = typed[field]
    if (!isPoint(raw)) {
      setInvalid((previous) => mark(previous, field, false))
      return
    }
    setInvalid((previous) => mark(previous, field, true))
    const value = Number(raw)
    // An edit that lands back on the value it started from has nothing to say,
    // and a revision would undo to a document identical to this one.
    if (draft[field] === value) return
    const nextPageSetup: PageSetup = { ...draft, [field]: value }
    setDraft(nextPageSetup)
    onChange(nextPageSetup)
  }

  return (
    <Panel title="页面设置">
      <div className="form-grid">
        {POINT_FIELDS.map((entry) => (
          <TextField
            key={entry.field}
            label={entry.label}
            type="number"
            min={1}
            step={1}
            disabled={disabled}
            value={typed[entry.field]}
            error={invalid.has(entry.field) ? INVALID_POINT : null}
            onChange={(event) => readPoint(entry.field, event.target.value)}
            onBlur={() => commitPoint(entry.field)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitPoint(entry.field)
            }}
          />
        ))}
        <SelectField
          label="栏数"
          disabled={disabled}
          options={COLUMN_OPTIONS}
          value={String(draft.columns)}
          onChange={(event) => {
            const nextPageSetup: PageSetup = {
              ...draft,
              columns: Number(event.target.value) === 2 ? 2 : 1,
            }
            setDraft(nextPageSetup)
            onChange(nextPageSetup)
          }}
        />
      </div>
    </Panel>
  )
}
