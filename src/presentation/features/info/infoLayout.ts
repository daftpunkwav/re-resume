/**
 * @file infoLayout
 * @description The width tiers of the information panel. The dock is one user
 * resizable column, so the panel has to fold its three regions as the column
 * narrows: navigation beside the list, then above it, then a single master or
 * detail view.
 *
 * Responsibilities:
 * - Name the tier thresholds in one place
 * - Observe the panel's own width and report the tier, so a dock resize and a
 *   window resize take the same path
 *
 * Constraints:
 * - The measurement is the panel element, not the window: the same window can
 *   show the panel at 320px or 720px.
 * - No container queries: the WebView baseline is Safari 15.
 */

import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

export type InfoLayoutTier = 'wide' | 'medium' | 'narrow'

/** Above this width the three regions stand side by side. */
const INFO_WIDE_MIN_WIDTH = 690

/** Above this width the list and the editor share the panel. */
const INFO_MEDIUM_MIN_WIDTH = 520

function infoLayoutTierForWidth(width: number): InfoLayoutTier {
  if (width >= INFO_WIDE_MIN_WIDTH) return 'wide'
  if (width >= INFO_MEDIUM_MIN_WIDTH) return 'medium'
  return 'narrow'
}

function measuredWidth(element: HTMLElement): number {
  const rect = element.getBoundingClientRect().width
  return rect > 0 ? rect : element.clientWidth
}

export function useInfoLayoutTier(ref: RefObject<HTMLElement | null>): InfoLayoutTier {
  const [tier, setTier] = useState<InfoLayoutTier>('narrow')

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    setTier(infoLayoutTierForWidth(measuredWidth(element)))
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setTier(infoLayoutTierForWidth(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return tier
}
