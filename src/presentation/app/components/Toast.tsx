/**
 * @file Toast
 * @description Bottom-centred confirmations that need no action. A toast is
 * removed after a short stay; anything the user must respond to belongs in a
 * Notice that stays on screen.
 *
 * Responsibilities:
 * - Render the store's toasts with enter and exit motion
 * - Own the dismissal timers, so the store holds no timers of its own
 *
 * Constraints:
 * - Motion is opacity and a short rise; reduced motion removes the rise.
 */

import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { useToastStore } from '../stores/toastStore'
import type { Toast, ToastTone } from '../stores/toastStore'

const TOAST_ICONS: Readonly<Record<ToastTone, IconName>> = {
  info: 'info',
  success: 'check',
  danger: 'alert',
}

const TOAST_VISIBLE_MS = 2400
const TOAST_EXIT_MS = 160

function ToastItem({ toast }: { readonly toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setLeaving(true), TOAST_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => dismiss(toast.id), TOAST_EXIT_MS)
    return () => clearTimeout(timer)
  }, [leaving, dismiss, toast.id])

  return (
    <div
      className={`toast toast-${toast.tone}`}
      data-leaving={leaving || undefined}
      role="status"
    >
      <Icon name={TOAST_ICONS[toast.tone]} size={15} />
      <span className="toast-message">{toast.message}</span>
    </div>
  )
}

export function ToastRegion() {
  const toasts = useToastStore((state) => state.toasts)
  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
