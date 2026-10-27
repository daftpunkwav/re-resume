/**
 * @file Popover
 * @description A small floating surface anchored to the control that opened
 * it. Escape and a click outside both close it, and closing returns focus to
 * whatever held it before the panel opened.
 *
 * Constraints:
 * - The caller owns the open state and renders the panel inside a positioned
 *   anchor alongside its trigger; this component owns the dismissal contract.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface PopoverProps {
  readonly open: boolean
  /** Accessible name of the panel. */
  readonly label: string
  readonly align?: 'start' | 'end'
  readonly onClose: () => void
  readonly children: ReactNode
}

export function Popover({ open, label, align = 'start', onClose, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      const panel = panelRef.current
      if (panel === null) return
      if (event.target instanceof Node && panel.contains(event.target)) return
      onCloseRef.current()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      opener?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className={`popover popover-${align}`}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      ref={panelRef}
    >
      {children}
    </div>
  )
}
