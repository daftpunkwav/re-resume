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
 * - The accent-to-hex mapping and the decoration geometry live in the domain's
 *   `Decoration`, which the canvas consumes too: the file prints what the
 *   canvas paints.
 */

import type { AppearanceSettings } from '../../../domain/resume/AppearanceSettings'
import type { TemplateDefinition } from '../../../domain/resume/Template'
import { resolveDecoration } from '../../../domain/resume/Decoration'

export const INK = '#111111'
export const MUTED = '#6b7280'
export const MISSING_IMAGE_BORDER = '#9ca3af'
export const MISSING_IMAGE_LABEL = '图片缺失'

export {
  ACCENT_BAR_OFFSET,
  ACCENT_BAR_WIDTH,
  BOXED_HEADING_BORDER_WIDTH,
  BOXED_HEADING_PADDING,
  RULE_THICKNESS,
} from '../../../domain/resume/Decoration'

export function pdfAccentColor(
  appearance: AppearanceSettings,
  template: TemplateDefinition,
): string | null {
  return resolveDecoration(appearance, template).accent
}

/** The colour decorations use: the accent when the template allows one, ink otherwise. */
export function decorationColor(accent: string | null): string {
  return accent ?? INK
}
