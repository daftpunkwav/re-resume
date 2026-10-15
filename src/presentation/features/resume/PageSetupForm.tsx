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

export function PageSetupForm({ pageSetup, disabled, onChange }: PageSetupFormProps) {
  // The draft follows the stored setup, so the committed value always wins
  // once a revision comes back — including one an undo has just rolled back.
  // Adjusting it while rendering, rather than in an effect, keeps the field
  // from showing a value for a render that the store has already replaced.
  const [draft, setDraft] = useState<PageSetup>(pageSetup)
  const [draftedFrom, setDraftedFrom] = useState<PageSetup>(pageSetup)
  const [invalid, setInvalid] = useState<ReadonlySet<PointField>>(new Set())

  if (draftedFrom !== pageSetup) {
    setDraftedFrom(pageSetup)
    setDraft(pageSetup)
  }

  const readPoint = (field: PointField, raw: string): void => {
    const value = Number(raw)
    const next = new Set(invalid)
    if (!Number.isFinite(value) || value <= 0) {
      next.add(field)
      setInvalid(next)
      return
    }
    next.delete(field)
    setInvalid(next)
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
            value={String(draft[entry.field])}
            error={invalid.has(entry.field) ? INVALID_POINT : null}
            onChange={(event) => readPoint(entry.field, event.target.value)}
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
