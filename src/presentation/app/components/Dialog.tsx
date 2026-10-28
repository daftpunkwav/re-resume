/**
 * @file Dialog
 * @description Modal overlay for confirmations and short forms.
 *
 * Constraints:
 * - Built from a plain div rather than <dialog>. showModal() only landed in
 *   Safari 15.4 and the WebView baseline is Safari 15.
 * - A pending operation owns the dialog: dismissing it now would unmount
 *   whatever the caller put inside to report the result.
 */

import type { ReactNode } from 'react'
import { useId } from 'react'
import { Button } from './Button'
import { useFocusTrap } from '../useFocusTrap'

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
  const descriptionId = useId()
  const panelRef = useFocusTrap<HTMLDivElement>({
    active: open,
    escapeEnabled: !busy,
    onEscape: onClose,
  })

  if (!open) return null

  const dismiss = (): void => {
    if (busy) return
    onClose()
  }

  return (
    <div
      className="dialog-scrim"
      // The backdrop carries no meaning of its own: closing is offered by
      // Escape, by 取消 and by the header's close button. Clicking outside is
      // a pointer shortcut on top of those, so the overlay stays out of the
      // tab order and out of the accessibility tree.
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="dialog-head">
          <h2 className="dialog-title">{title}</h2>
          <Button
            variant="ghost"
            size="small"
            iconOnly
            icon="close"
            aria-label="关闭"
            onClick={dismiss}
            disabled={busy}
          />
        </header>
        <div className="dialog-body">
          {description === undefined ? null : (
            <p className="dialog-description" id={descriptionId}>
              {description}
            </p>
          )}
          {children}
        </div>
        <footer className="dialog-foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </footer>
      </div>
    </div>
  )
}
