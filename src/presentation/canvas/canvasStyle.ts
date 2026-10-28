/**
 * @file canvasStyle
 * @description The constants and font declaration the resume canvas paints with.
 * They are separate from the drawing components so the page and the block
 * layers can share them without one importing the other.
 */

import { cssFamilyName } from '../../domain/resume/TextStyle'

/** White paper; the exported document is always white regardless of the theme. */
export const PAPER_FILL = '#ffffff'
export const INK = '#1b1d21'
export const SELECTION_FALLBACK = '#2563eb'
export const OVERFLOW_COLOUR = '#dc2626'
export const MISSING_COLOUR = '#9a3412'

/** Vertical gap between stacked pages, in CSS pixels; not affected by zoom. */
export const PAGE_GAP = 24

/** Family declaration a Konva text node can use; the bundled face plus a system fallback. */
export function fontFamilyOf(family: string): string {
  return `${cssFamilyName(family)}, "Microsoft YaHei", "PingFang SC", sans-serif`
}
