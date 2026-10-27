/**
 * @file Button
 * @description The clickable control primitive. Variants map onto the theme's
 * accent roles, so one set of rules serves all five palettes.
 *
 * Responsibilities:
 * - Paint the state matrix: hover, active, focus-visible, disabled, loading
 * - Keep the button's width while loading, so committing an action does not
 *   shift the layout around it
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export type ButtonSize = 'small' | 'medium'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly icon?: IconName
  /** Renders the button as icon-only and requires an accessible name. */
  readonly iconOnly?: boolean
  /** Fills the available width. */
  readonly block?: boolean
  /** Shows a spinner in place of the content without collapsing the width. */
  readonly loading?: boolean
  readonly children?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'medium',
  icon,
  iconOnly = false,
  block = false,
  loading = false,
  className,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['button', `button-${variant}`, `button-${size}`]
  if (iconOnly) classes.push('button-icon-only')
  if (block) classes.push('button-block')
  if (loading) classes.push('button-loading')

  const glyph = icon === undefined || loading ? null : (
    <Icon name={icon} size={size === 'small' ? 14 : 16} />
  )

  return (
    <button
      type={type}
      className={[...classes, className].filter(Boolean).join(' ')}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {glyph}
      {iconOnly || children === undefined ? null : <span className="button-label">{children}</span>}
      {loading ? <span className="button-spinner" aria-hidden="true" /> : null}
    </button>
  )
}
