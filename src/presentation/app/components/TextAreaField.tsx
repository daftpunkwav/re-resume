/**
 * @file TextAreaField
 * @description Multi-line labeled input for variant and claim bodies.
 */

import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { FieldShell } from './FieldShell'

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label: string
  readonly hint?: ReactNode
  readonly error?: string | null
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  rows = 4,
  ...rest
}: TextAreaFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ inputId, describedBy }) => (
        <textarea
          {...rest}
          rows={rows}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={error === undefined || error === null ? undefined : true}
          className={['field-control', 'field-textarea', className].filter(Boolean).join(' ')}
        />
      )}
    </FieldShell>
  )
}
