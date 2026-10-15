/**
 * @file FieldShell
 * @description Label, control, hint and error in one arrangement. Every form
 * control in the app goes through it so spacing and the aria wiring for the
 * description are identical everywhere.
 */

import type { ReactNode } from 'react'
import { useId } from 'react'
import { Icon } from './Icon'

export interface FieldShellRenderProps {
  readonly inputId: string
  readonly describedBy: string | undefined
}

export interface FieldShellProps {
  readonly label: string
  readonly hint?: ReactNode
  readonly error?: string | null
  readonly children: (props: FieldShellRenderProps) => ReactNode
}

export function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const inputId = useId()
  const hasError = error !== undefined && error !== null
  const hasHint = hint !== undefined && !hasError
  const describedBy = hasError ? `${inputId}-error` : hasHint ? `${inputId}-hint` : undefined

  return (
    <div className="field">
      <label className="field-label" htmlFor={inputId}>
        {label}
      </label>
      {children({ inputId, describedBy })}
      {hasError ? (
        <p className="field-error" id={`${inputId}-error`}>
          <Icon name="alert" size={12} />
          {error}
        </p>
      ) : null}
      {hasHint ? (
        <p className="field-hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
