/**
 * @file InfoChoiceDialog
 * @description A confirmation with three answers, for the one question the
 * shared two-button Dialog cannot ask: save the draft, throw it away, or stay.
 *
 * Constraints:
 * - The scrim, panel and footer reuse the design system's dialog classes and
 *   the same focus trap; only the action row differs from Dialog.
 * - At most one of these is open at a time, and each action is the caller's.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'
import { useFocusTrap } from '../../app/useFocusTrap'
import { Button } from '../../app/components/Button'
import type { ButtonVariant } from '../../app/components/Button'

interface ChoiceAction {
  readonly label: string
  readonly variant?: ButtonVariant
  readonly onClick: () => void
  /** True while the action runs; the dialog then ignores dismissal. */
  readonly busy?: boolean
}

export interface InfoChoiceDialogProps {
  readonly open: boolean
  readonly title: string
  readonly description: ReactNode
  readonly actions: readonly ChoiceAction[]
  readonly onClose: () => void
}

export function InfoChoiceDialog({
  open,
  title,
  description,
  actions,
  onClose,
}: InfoChoiceDialogProps) {
  const descriptionId = useId()
  const busy = actions.some((action) => action.busy === true)
  const panelRef = useFocusTrap<HTMLDivElement>({
    active: open,
    escapeEnabled: !busy,
    onEscape: onClose,
  })

  if (!open) return null

  return (
    <div
      className="dialog-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="dialog info-choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={descriptionId}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="dialog-head">
          <h2 className="dialog-title">{title}</h2>
        </header>
        <div className="dialog-body">
          <p className="dialog-description" id={descriptionId}>
            {description}
          </p>
        </div>
        <footer className="dialog-foot">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant ?? 'secondary'}
              loading={action.busy === true}
              onClick={action.onClick}
              disabled={busy && action.busy !== true}
            >
              {action.label}
            </Button>
          ))}
        </footer>
      </div>
    </div>
  )
}
