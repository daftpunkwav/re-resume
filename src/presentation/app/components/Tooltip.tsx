/**
 * @file Tooltip
 * @description A short label that appears next to a control on hover or
 * keyboard focus. The bubble is drawn from a data attribute, so it adds no DOM
 * and cannot be reached by Tab.
 *
 * Constraints:
 * - Decorative only: the control it wraps must already carry an accessible
 *   name. A tooltip is not a substitute for a label.
 * - A mouse click leaves the control focused; the bubble is hidden on pointer
 *   down so it does not stay pinned over the window until focus moves. Keyboard
 *   focus still shows it, which is the case the tooltip exists for.
 */

import { useState } from 'react'
import type { FocusEvent, ReactNode } from 'react'

export interface TooltipProps {
  readonly label: string
  readonly children: ReactNode
  /** Where the bubble sits relative to the control. */
  readonly placement?: 'top' | 'bottom'
}

/**
 * Where `:focus-visible` exists it tells keyboard focus from a click. The
 * engines that cannot parse it fall back to treating any focus as keyboard
 * focus, which is the pre-`:focus-visible` behaviour.
 */
function focusedByKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  try {
    return target.matches(':focus-visible')
  } catch {
    return true
  }
}

export function Tooltip({ label, children, placement = 'bottom' }: TooltipProps) {
  const [visible, setVisible] = useState(false)

  const hide = (): void => setVisible(false)

  const onFocus = (event: FocusEvent<HTMLSpanElement>): void => {
    setVisible(focusedByKeyboard(event.target))
  }

  const onBlur = (event: FocusEvent<HTMLSpanElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    hide()
  }

  return (
    <span
      className={`tooltip tooltip-${placement}`}
      data-tooltip={label}
      data-visible={visible ? '' : undefined}
      onPointerEnter={() => setVisible(true)}
      onPointerLeave={hide}
      onPointerDown={() => hide()}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {children}
    </span>
  )
}
