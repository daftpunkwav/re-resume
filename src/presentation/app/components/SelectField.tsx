/**
 * @file SelectField
 * @description Labeled dropdown. The chevron is drawn rather than native so it
 * follows the theme in both colour schemes.
 */

import type { ReactNode, SelectHTMLAttributes } from 'react'
import { FieldShell } from './FieldShell'
import { Icon } from './Icon'

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly label: string
  readonly options: readonly SelectOption[]
  readonly hint?: ReactNode
  readonly error?: string | null
}

export function SelectField({
  label,
  options,
  hint,
  error,
  className,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ inputId, describedBy }) => (
        <span className="field-select-wrap">
          <select
            {...rest}
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={error === undefined || error === null ? undefined : true}
            className={['field-control', 'field-select', className].filter(Boolean).join(' ')}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} />
        </span>
      )}
    </FieldShell>
  )
}
