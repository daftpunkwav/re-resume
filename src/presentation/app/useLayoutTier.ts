/**
 * @file useLayoutTier
 * @description The three window widths the workbench lays out for, plus the
 * narrower question of whether the right dock can show both panels side by
 * side. The shell writes the tier onto its root element and the stylesheet
 * selects on it, so the breakpoint exists once instead of once in JavaScript
 * and again in a CSS media query.
 *
 * Constraints:
 * - Resizing below a breakpoint does not change the stored panel preferences;
 *   the rendered width is clamped, the user's choice is not. A window that is
 *   widened again returns to the width the user set.
 * - Two dock panes at their own minimum would leave a 1280px window with about
 *   300px of conversation, so the split has a higher floor than the wide tier.
 */

import { useEffect, useState } from 'react'

export type LayoutTier = 'wide' | 'medium' | 'compact'

export const WIDE_LAYOUT_MIN_WIDTH = 1240
export const MEDIUM_LAYOUT_MIN_WIDTH = 1060

/**
 * The window width at which the dock may split into two panes. The dock then
 * takes two panel minimums (640px) beside the sidebar and a readable
 * conversation column; a narrower window keeps one pane at a time.
 */
export const WIDE_SPLIT_MIN_WIDTH = 1560

export function layoutTierForWidth(width: number): LayoutTier {
  if (width >= WIDE_LAYOUT_MIN_WIDTH) return 'wide'
  if (width >= MEDIUM_LAYOUT_MIN_WIDTH) return 'medium'
  return 'compact'
}

/** Whether two dock panes can open side by side at this window width. */
export function canSplitPanels(width: number): boolean {
  return width >= WIDE_SPLIT_MIN_WIDTH
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

/**
 * The window width, tracked so the dock can fall back to one pane while the
 * window narrows and split again when it widens, without changing preferences.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return width
}
