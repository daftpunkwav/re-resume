/**
 * @file Dialog
 * @description Modal overlay for destructive or multi-step confirmations.
 *
 * Constraints:
 * - Built from a plain div rather than <dialog>. showModal() only landed in
 *   Safari 15.4 and the WebView baseline is Safari 15.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'

/** What Tab may reach inside the panel: the controls that are there and able
 *  to take focus. A busy footer button is skipped, as is anything the author
 *  took out of the tab order with tabIndex={-1}. */
function focusStops(panel: HTMLDivElement | null): HTMLElement[] {
  if (panel === null) return []
  return Array.from(
    panel.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'),
  ).filter(
    (element) =>
      !element.hasAttribute('disabled') && element.getAttribute('tabindex') !== '-1',
  )
}

export interface DialogProps {
  readonly open: boolean
  readonly title: string
  readonly description?: ReactNode
  readonly children?: ReactNode
  readonly confirmLabel?: string
  readonly cancelLabel?: string
  readonly destructive?: boolean
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onClose: () => void
}

export function Dialog({
  open,
  title,
  description,
  children,
  confirmLabel = '确定',
  cancelLabel = '取消',
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(busy)

  useEffect(() => {
    onCloseRef.current = onClose
    busyRef.current = busy
  }, [busy, onClose])

  /**
   * A pending operation owns the dialog: dismissing it now unmounts whatever
   * the caller put inside to report the result, which is the same reason the
   * footer buttons are disabled. Both live in refs so that neither a fresh
   * onClose nor a change of busy restarts the focus effect below.
   */
  const dismiss = (): void => {
    if (busyRef.current) return
    onCloseRef.current()
  }

  /**
   * A dialog owns the keyboard while it is open: focus moves into it once,
   * Tab cannot walk out into the page behind it, and closing hands focus back
   * to whatever opened it. The handler is held in a ref so a parent that
   * re-renders with a fresh onClose does not re-run the effect and steal the
   * focus back out of the field the user is typing in.
   */
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss()
        return
      }
      if (event.key !== 'Tab') return
      const stops = focusStops(panelRef.current)
      if (stops.length === 0) return
      const first = stops[0]
      const last = stops[stops.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault()
        last?.focus()
        return
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="dialog-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="dialog-head">
          <h2 className="dialog-title">{title}</h2>
          <Button variant="ghost" size="small" iconOnly icon="close" aria-label="关闭" onClick={dismiss} disabled={busy} />
        </header>
        <div className="dialog-body">
          {description === undefined ? null : <p className="dialog-description">{description}</p>}
          {children}
        </div>
        <footer className="dialog-foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </footer>
      </div>
    </div>
  )
}
