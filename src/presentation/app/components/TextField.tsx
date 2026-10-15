/**
 * @file TextField
 * @description Single-line labeled input.
 */

import type { InputHTMLAttributes, ReactNode } from 'react'
import { FieldShell } from './FieldShell'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string
  readonly hint?: ReactNode
  readonly error?: string | null
}

export function TextField({ label, hint, error, className, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ inputId, describedBy }) => (
        <input
          {...rest}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={error === undefined || error === null ? undefined : true}
          className={['field-control', className].filter(Boolean).join(' ')}
        />
      )}
    </FieldShell>
  )
}
