/**
 * @file shortcuts
 * @description The one place global keyboard shortcuts are decided. Every
 * handler is registered here and dispatched from a single capture-phase
 * listener, so two regions can never claim the same key.
 *
 * Responsibilities:
 * - Turn a key event into at most one intent
 * - Leave typing alone: an editable target or an active IME composition passes
 *   the event through untouched
 * - Dispatch the intent to the shell
 *
 * Constraints:
 * - Capture phase, so a shortcut still works while a region below is focused.
 * - Only the primary modifier (Ctrl on Windows and Linux, Cmd on macOS) is
 *   claimed; Alt and the bare function keys stay with the platform.
 */

import { useEffect, useRef } from 'react'
import type { FocusDomain } from './stores/shellStore'

export type ShortcutAction =
  | { readonly kind: 'newConversation' }
  | { readonly kind: 'toggleSettings' }
  | { readonly kind: 'togglePanel' }
  | { readonly kind: 'focusDomain'; readonly domain: FocusDomain }
  | { readonly kind: 'scale'; readonly direction: 1 | -1 }
  | { readonly kind: 'resetScale' }

export interface ShortcutHandlers {
  readonly newConversation: () => void
  readonly toggleSettings: () => void
  readonly togglePanel: () => void
  readonly focusDomain: (domain: FocusDomain) => void
  readonly adjustScale: (direction: 1 | -1) => void
  readonly resetScale: () => void
}

/** True for a control that expects the keys it receives to be text. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (target.isContentEditable) return true
  return target.closest('[contenteditable="true"]') !== null
}

type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing' | 'target'
>

export function shortcutForEvent(event: ShortcutKeyEvent): ShortcutAction | null {
  // An IME composition owns every key it sees, Escape included; a shortcut
  // fired in the middle of one would act on text the user has not committed.
  if (event.isComposing) return null
  if (isEditableTarget(event.target)) return null
  if (!(event.ctrlKey || event.metaKey)) return null
  if (event.altKey) return null

  switch (event.key.toLowerCase()) {
    case 'n':
      return { kind: 'newConversation' }
    case ',':
      return { kind: 'toggleSettings' }
    case 'b':
      return { kind: 'togglePanel' }
    case '1':
      return { kind: 'focusDomain', domain: 'sidebar' }
    case '2':
      return { kind: 'focusDomain', domain: 'conversation' }
    case '3':
      return { kind: 'focusDomain', domain: 'panel' }
    case '=':
    case '+':
      return { kind: 'scale', direction: 1 }
    case '-':
    case '_':
      return { kind: 'scale', direction: -1 }
    case '0':
      return { kind: 'resetScale' }
    default:
      return null
  }
}

function dispatch(action: ShortcutAction, handlers: ShortcutHandlers): void {
  switch (action.kind) {
    case 'newConversation':
      handlers.newConversation()
      return
    case 'toggleSettings':
      handlers.toggleSettings()
      return
    case 'togglePanel':
      handlers.togglePanel()
      return
    case 'focusDomain':
      handlers.focusDomain(action.domain)
      return
    case 'scale':
      handlers.adjustScale(action.direction)
      return
    case 'resetScale':
      handlers.resetScale()
      return
  }
}

export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  // The listener is installed once; the handlers it calls are read through a
  // ref that is refreshed after each render, so a re-render does not
  // uninstall and reinstall the listener.
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = shortcutForEvent(event)
      if (action === null) return
      event.preventDefault()
      dispatch(action, handlersRef.current)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
