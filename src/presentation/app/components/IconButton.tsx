/**
 * @file IconButton
 * @description A square button that shows only an icon. The accessible name is
 * required rather than optional, and the same name is what the tooltip shows,
 * so a pointer user and a screen-reader user read the same words.
 */

import type { ButtonHTMLAttributes } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { Tooltip } from './Tooltip'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  readonly icon: IconName
  readonly label: string
  readonly variant?: 'ghost' | 'secondary'
  readonly size?: 'small' | 'medium'
  /** Set for a toggle; omit for a plain action. */
  readonly pressed?: boolean
  readonly showTooltip?: boolean
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'medium',
  pressed,
  showTooltip = true,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      className={[
        'icon-button',
        `icon-button-${variant}`,
        `icon-button-${size}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} size={size === 'small' ? 14 : 16} />
    </button>
  )

  return showTooltip ? (
    <Tooltip label={label} placement="bottom">
      {button}
    </Tooltip>
  ) : (
    button
  )
}
