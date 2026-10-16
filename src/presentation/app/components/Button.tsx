/**
 * @file Button
 * @description The only clickable control primitive. Variants map onto the
 * theme's accent roles, so one set of rules serves all five palettes.
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
  readonly children?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'medium',
  icon,
  iconOnly = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = ['button', `button-${variant}`, `button-${size}`]
  if (iconOnly) classes.push('button-icon-only')

  return (
    <button
      type={type}
      className={[...classes, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {icon === undefined ? null : <Icon name={icon} size={size === 'small' ? 14 : 16} />}
      {iconOnly || children === undefined ? null : <span>{children}</span>}
    </button>
  )
}
