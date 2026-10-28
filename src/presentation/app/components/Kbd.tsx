/**
 * @file Kbd
 * @description A key cap and a shortcut made of key caps. The primary modifier
 * is spelled for the platform the window runs on, so the shortcut list matches
 * the keys under the user's hands.
 */

import type { ReactNode } from 'react'

export function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

/** The platform's primary modifier: Cmd on macOS, Ctrl elsewhere. */
export function primaryModifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /mac|iphone|ipad/i.test(navigator.platform) ? '⌘' : 'Ctrl'
}

export interface ShortcutKeysProps {
  /** Keys in order, for example ['Ctrl', 'N']. */
  readonly keys: readonly string[]
}

export function ShortcutKeys({ keys }: ShortcutKeysProps) {
  return (
    <span className="shortcut-keys">
      {keys.map((key, index) => (
        <span className="shortcut-key" key={key}>
          {index === 0 ? null : (
            <span className="shortcut-plus" aria-hidden="true">
              +
            </span>
          )}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </span>
  )
}
