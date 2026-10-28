/**
 * @file toastStore
 * @description Short-lived confirmations and refusals. A toast is for feedback
 * that needs no action: anything the user has to act on belongs in a Notice
 * that stays on screen.
 *
 * Constraints:
 * - At most three toasts are held: a queue nobody reads is a queue that grows.
 * - No timers live in the store; the region that renders them owns the timeout,
 *   so a toast that is removed early cannot leave a timer behind.
 */

import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'danger'

export interface Toast {
  readonly id: number
  readonly tone: ToastTone
  readonly message: string
}

export const MAX_VISIBLE_TOASTS = 3

interface ToastState {
  readonly toasts: readonly Toast[]
  push(tone: ToastTone, message: string): void
  dismiss(id: number): void
}

let nextToastId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push(tone, message) {
    const toast: Toast = { id: nextToastId, tone, message }
    nextToastId += 1
    set((state) => ({ toasts: [...state.toasts, toast].slice(-MAX_VISIBLE_TOASTS) }))
  },
  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  },
}))

/** Convenience for callers outside a component. */
export function showToast(tone: ToastTone, message: string): void {
  useToastStore.getState().push(tone, message)
}
