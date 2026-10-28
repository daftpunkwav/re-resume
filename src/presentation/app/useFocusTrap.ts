/**
 * @file useFocusTrap
 * @description The keyboard contract of a modal surface: focus moves into it,
 * Tab cannot walk out into the page behind it, Escape asks the owner to close,
 * and closing hands focus back to whatever opened it.
 *
 * Responsibilities:
 * - Compute the tab stops of the panel from its live content
 * - Restore the opener's focus when the trap deactivates
 *
 * Constraints:
 * - Escape is dispatched through the latest callback, so a re-render with a
 *   fresh callback neither restarts the trap nor steals focus back out of the
 *   field the user is typing in.
 * - Built on a div, not <dialog>: showModal() only landed in Safari 15.4.
 */

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** What Tab may reach inside the panel. */
function focusStops(panel: HTMLElement | null): HTMLElement[] {
  if (panel === null) return []
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute('disabled') && element.getAttribute('tabindex') !== '-1',
  )
}

export interface FocusTrapConfig {
  readonly active: boolean
  /** Called for Escape; omitted traps still keep Tab inside. */
  readonly onEscape?: () => void
  /** Escape is ignored while another operation owns the surface. */
  readonly escapeEnabled?: boolean
}

export function useFocusTrap<T extends HTMLElement>(
  config: FocusTrapConfig,
): RefObject<T | null> {
  const panelRef = useRef<T>(null)
  const escapeRef = useRef(config.onEscape)
  const escapeEnabledRef = useRef(config.escapeEnabled ?? true)
  const { active } = config

  useEffect(() => {
    escapeRef.current = config.onEscape
    escapeEnabledRef.current = config.escapeEnabled ?? true
  }, [config.onEscape, config.escapeEnabled])

  useEffect(() => {
    if (!active) return
    const panel = panelRef.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!escapeEnabledRef.current) return
        event.preventDefault()
        escapeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const stops = focusStops(panel)
      if (stops.length === 0) return
      const first = stops[0]
      const last = stops[stops.length - 1]
      const activeElement = document.activeElement
      if (event.shiftKey && (activeElement === first || activeElement === panel)) {
        event.preventDefault()
        last?.focus()
        return
      }
      if (!event.shiftKey && activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [active])

  return panelRef
}
