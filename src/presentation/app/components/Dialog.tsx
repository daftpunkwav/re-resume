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

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="dialog-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
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
          <Button variant="ghost" size="small" iconOnly icon="close" aria-label="关闭" onClick={onClose} />
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
