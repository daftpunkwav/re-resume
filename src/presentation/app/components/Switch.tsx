/**
 * @file Switch
 * @description A two-state control for a preference that takes effect at once.
 * The track and the thumb are drawn from theme tokens, so the control looks
 * native to the theme rather than like a checkbox the browser painted.
 */

import { useId } from 'react'

export interface SwitchProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  /** A short line under the label explaining what the switch does. */
  readonly description?: string
  readonly disabled?: boolean
}

export function Switch({ label, checked, onChange, description, disabled = false }: SwitchProps) {
  const labelId = useId()
  const descriptionId = useId()

  return (
    <div className="switch-field">
      <div className="switch-copy">
        <span className="switch-label" id={labelId}>
          {label}
        </span>
        {description === undefined ? null : (
          <span className="switch-description" id={descriptionId}>
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        className={checked ? 'switch switch-on' : 'switch'}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" aria-hidden="true" />
      </button>
    </div>
  )
}
