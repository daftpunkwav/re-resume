/**
 * @file usePresence
 * @description Keeps an overlay mounted for the length of its exit transition,
 * so a panel that fades in also fades out instead of disappearing.
 *
 * Constraints:
 * - Every state change is scheduled, never applied synchronously while an
 *   effect body runs: the phase machine reads the same value the render uses.
 * - The exit is not waited out when motion is reduced: the operating-system
 *   setting or the in-app switch turns the animation off, and a timer that
 *   still waited would only delay the DOM change.
 */

import { useEffect, useState } from 'react'

export interface Presence {
  /** Whether the overlay should be in the DOM. */
  readonly mounted: boolean
  /** Whether it is on its way out; the stylesheet animates this state. */
  readonly closing: boolean
}

type Phase = 'closed' | 'open' | 'closing'

function motionIsReduced(): boolean {
  if (document.documentElement.getAttribute('data-motion') === 'reduced') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function usePresence(open: boolean, exitMs: number): Presence {
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed')

  useEffect(() => {
    if (open) {
      if (phase === 'open') return
      const timer = setTimeout(() => setPhase('open'), 0)
      return () => clearTimeout(timer)
    }
    if (phase === 'closed') return
    if (phase === 'open') {
      const timer = setTimeout(() => setPhase('closing'), 0)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setPhase('closed'), motionIsReduced() ? 0 : exitMs)
    return () => clearTimeout(timer)
  }, [open, phase, exitMs])

  return { mounted: phase !== 'closed', closing: phase === 'closing' }
}
