/**
 * @file Decoration
 * @description The page-decoration vocabulary a document's appearance selects:
 * the accent colour and the section-heading treatment. Both renderers consume
 * the same resolved record — the canvas paints what the PDF prints, so the
 * mapping from appearance to concrete values lives here and nowhere else.
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - The `minimal` template ignores the accent by design: its decorations fall
 *   back to ink rather than inventing a second palette.
 * - Geometry values are in page points; a renderer scales them to its own unit.
 */

import type { AppearanceSettings, AccentColor, HeadingStyle } from './AppearanceSettings'
import type { TemplateDefinition } from './Template'

/** The accent colour each appearance token maps to. */
export const ACCENT_HEX: Readonly<Record<AccentColor, string>> = {
  ink: '#1f2933',
  blue: '#2563eb',
  teal: '#0f766e',
  green: '#15803d',
  amber: '#b45309',
  rose: '#be123c',
}

/** The ink the decorations fall back to when the template ignores the accent. */
export const DECORATION_INK = '#111111'

/** 1pt rules: divider bands, section underlines and the header rule. */
export const RULE_THICKNESS = 1

/** Width of the accent bar an `accentBar` heading draws, in points. */
export const ACCENT_BAR_WIDTH = 2.5

/** Distance the accent bar sits to the left of the heading text, in points. */
export const ACCENT_BAR_OFFSET = 6

/** Vertical padding a `boxed` heading adds above and below its text, in points. */
export const BOXED_HEADING_PADDING = 4

/** Border width of a `boxed` heading, in points. */
export const BOXED_HEADING_BORDER_WIDTH = 0.75

/** The decoration a document renders with, resolved once for both renderers. */
export interface ResolvedDecoration {
  /**
   * The accent hex the decorations draw with, or null when the template
   * ignores the accent and everything falls back to ink.
   */
  readonly accent: string | null
  readonly headingStyle: HeadingStyle
}

/**
 * Resolves the appearance and the template into the decoration record. A
 * template that ignores the accent yields null so a renderer cannot invent a
 * colour the file would not carry.
 */
export function resolveDecoration(
  appearance: AppearanceSettings,
  template: TemplateDefinition,
): ResolvedDecoration {
  const accent =
    template.id === 'minimal' ? null : (ACCENT_HEX[appearance.accentColor] ?? DECORATION_INK)
  return { accent, headingStyle: appearance.headingStyle }
}

/** The colour decorations use: the accent when the template allows one, ink otherwise. */
export function decorationColor(accent: string | null): string {
  return accent ?? DECORATION_INK
}
