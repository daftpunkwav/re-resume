/**
 * @file useLayoutTier
 * @description The three window widths the workbench lays out for. The shell
 * writes the tier onto its root element and the stylesheet selects on it, so
 * the breakpoint exists once instead of once in JavaScript and again in CSS.
 *
 * Constraints:
 * - Resizing below a breakpoint does not change the stored panel preferences;
 *   the rendered width is clamped, the user's choice is not. A window that is
 *   widened again returns to the width the user set.
 */

import { useEffect, useState } from 'react'

export type LayoutTier = 'wide' | 'medium' | 'compact'

export const WIDE_LAYOUT_MIN_WIDTH = 1240
export const MEDIUM_LAYOUT_MIN_WIDTH = 1060

export function layoutTierForWidth(width: number): LayoutTier {
  if (width >= WIDE_LAYOUT_MIN_WIDTH) return 'wide'
  if (width >= MEDIUM_LAYOUT_MIN_WIDTH) return 'medium'
  return 'compact'
}

function readTier(): LayoutTier {
  return layoutTierForWidth(window.innerWidth)
}

export function useLayoutTier(): LayoutTier {
  const [tier, setTier] = useState<LayoutTier>(readTier)

  useEffect(() => {
    const onResize = (): void => setTier(readTier())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return tier
}
