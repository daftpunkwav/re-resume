/**
 * @file KnowledgeDateField
 * @description The editor for a month-precision date field. The value is the
 * canonical text the model stores (`YYYY`, `YYYY-MM` or `present`), typed into
 * a short text field with the formatted reading underneath; an end date also
 * offers the ongoing state as a switch rather than a magic value.
 *
 * Responsibilities:
 * - Report the canonical text upward; the field never stores a Date
 * - Keep the last typed text while the ongoing state is on, so toggling back
 *   restores what the user wrote
 * - Preview the formatted value through the domain formatter
 *
 * Constraints:
 * - Parsing is `parseKnowledgeDate`, the same function validation uses; this
 *   control does not accept a spelling the model would refuse.
 * - No native month input: a year-only value has no month to show in one, and
 *   silently inventing January would change the stored fact.
 */

import { useRef, useState } from 'react'
import { formatKnowledgeDate, parseKnowledgeDate } from '../../../../domain/shared/KnowledgeDate'
import { FieldShell } from '../../../app/components/FieldShell'

export interface KnowledgeDateFieldProps {
  readonly label: string
  readonly value: string
  readonly required: boolean
  /** True for an end date, which may hold `present`. */
  readonly allowPresent: boolean
  readonly error: string | null
  readonly onChange: (value: string) => void
}

/** The hint line: the formatted value, or why the typed text is not a date yet. */
function dateHint(value: string, allowPresent: boolean): string | null {
  if (value === '') {
    return allowPresent ? '2024-06 / 2024；可「至今」' : '2024-06 / 2024'
  }
  const parsed = parseKnowledgeDate(value)
  if (parsed === null) return null
  if (parsed === 'present') return allowPresent ? null : '开始时间不能是「至今」。'
  return formatKnowledgeDate(parsed)
}

export function KnowledgeDateField({
  label,
  value,
  required,
  allowPresent,
  error,
  onChange,
}: KnowledgeDateFieldProps) {
  const ongoing = value === 'present'
  const lastText = useRef(ongoing ? '' : value)
  const [touched, setTouched] = useState(false)
  const parsed = value === '' ? null : parseKnowledgeDate(value)
  const unreadable = touched && value !== '' && !ongoing && parsed === null
  const hint = dateHint(value, allowPresent)

  return (
    <FieldShell
      label={required ? `${label} *` : label}
      error={error ?? (unreadable ? '日期格式应为 2024-06 或 2024。' : null)}
      hint={hint}
    >
      {({ inputId, describedBy }) => (
        <div className="info-date-row">
          <input
            id={inputId}
            className="field-control info-date-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={ongoing ? '至今' : allowPresent ? '' : '2024-06'}
            value={ongoing ? '' : value}
            disabled={ongoing}
            aria-describedby={describedBy}
            aria-invalid={error !== null || unreadable ? true : undefined}
            onBlur={() => setTouched(true)}
            onChange={(event) => {
              setTouched(false)
              lastText.current = event.target.value
              onChange(event.target.value)
            }}
          />
          {allowPresent ? (
            <button
              type="button"
              role="switch"
              aria-checked={ongoing}
              className={ongoing ? 'info-present info-present-on' : 'info-present'}
              onClick={() => {
                if (ongoing) {
                  onChange(lastText.current)
                  return
                }
                lastText.current = value
                onChange('present')
              }}
            >
              <span className="info-present-dot" aria-hidden="true" />
              至今
            </button>
          ) : null}
        </div>
      )}
    </FieldShell>
  )
}
