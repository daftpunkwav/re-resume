/**
 * @file useDebouncedCommit
 * @description Delays a write until a continuous gesture settles. Sliders and
 * switches that write on every pointer move would create one revision per
 * pixel; the panel keeps its own draft for the visible value and commits once
 * the gesture pauses.
 *
 * Constraints:
 * - The timer is cleared on unmount, and a new schedule replaces the pending
 *   one, so a closed panel cannot commit later.
 */

import { useCallback, useEffect, useRef } from 'react'

export function useDebouncedCommit(delayMs = 260): (commit: () => void) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => cancel, [cancel])

  return useCallback(
    (commit: () => void) => {
      cancel()
      timer.current = setTimeout(() => {
        timer.current = null
        commit()
      }, delayMs)
    },
    [cancel, delayMs],
  )
}
