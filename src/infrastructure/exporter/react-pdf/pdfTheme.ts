/**
 * @file pdfTheme
 * @description The colour vocabulary the PDF renderer draws with. Body text is
 * ink; the accent colour comes from the resume's appearance and is mapped to a
 * printable hex value here, so a template only names a token and the file
 * carries a concrete colour.
 *
 * Constraints:
 * - `minimal` ignores the accent colour by design, so the decoration helpers
 *   fall back to ink there rather than inventing a second palette.
 * - Colours are chosen to stay legible on white paper; no transparency is used
 *   because the renderer has to flatten every fill.
 */

import type { AccentColor } from '../../../domain/resume/AppearanceSettings'
import type { AppearanceSettings } from '../../../domain/resume/AppearanceSettings'
import type { TemplateDefinition } from '../../../domain/resume/Template'

export const INK = '#111111'
export const MUTED = '#6b7280'
export const MISSING_IMAGE_BORDER = '#9ca3af'
export const MISSING_IMAGE_LABEL = '图片缺失'

/** The accent colour each appearance token maps to. */
export const ACCENT_HEX: Readonly<Record<AccentColor, string>> = {
  ink: '#1f2933',
  blue: '#2563eb',
  teal: '#0f766e',
  green: '#15803d',
  amber: '#b45309',
  rose: '#be123c',
}

/** 1pt rules: divider bands, section underlines and the header rule. */
export const RULE_THICKNESS = 1

/** Width of the accent bar a `accentBar` heading draws, in points. */
export const ACCENT_BAR_WIDTH = 2.5

/** Distance the accent bar sits to the left of the heading text, in points. */
export const ACCENT_BAR_OFFSET = 6

export function pdfAccentColor(
  appearance: AppearanceSettings,
  template: TemplateDefinition,
): string | null {
  if (template.id === 'minimal') return null
  return ACCENT_HEX[appearance.accentColor] ?? INK
}

/** The colour decorations use: the accent when the template allows one, ink otherwise. */
export function decorationColor(accent: string | null): string {
  return accent ?? INK
}
