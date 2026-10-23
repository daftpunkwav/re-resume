/**
 * @file TextStyle
 * @description Per-block text styling. A block whose textStyle is null falls
 * back to DEFAULT_TEXT_STYLE, which is the only inheritance rule in v1.
 *
 * Constraints:
 * - Named textStyle because it governs text only; graphics and dividers have
 *   no style source yet.
 */

export interface TextStyle {
  readonly fontFamily: string
  /** Unit: points. */
  readonly fontSize: number
  readonly fontWeight: number
  readonly lineHeight: number
}

/**
 * The family the application bundles (Noto Sans SC, see
 * public/fonts/README.md) and registers under this exact name — both in
 * the canonical measurer's FontRegistry and in the document's FontFaceSet for
 * canvas drawing. Layout fails loudly when a referenced family is missing
 * from the registry, which is what keeps this name honest.
 */
export const DEFAULT_FONT_FAMILY = 'Noto Sans SC'

/**
 * The family name as a CSS font declaration spells it.
 *
 * A family name whose last token starts with a digit — "Noto Sans Symbols 2" —
 * is not a valid unquoted CSS family name, and the FontFace constructor
 * rejects it. Quoting the name is always valid, and it names the very family
 * the FontFaceSet holds: the quotes are syntax, not part of the name.
 */
export function cssFamilyName(family: string): string {
  return `"${family}"`
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: 11,
  fontWeight: 400,
  lineHeight: 1.5,
}

export function resolveTextStyle(style: TextStyle | null): TextStyle {
  return style ?? DEFAULT_TEXT_STYLE
}
