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
 * "sans-serif" is a resolution key rather than a literal family name: each
 * measurer maps it to whatever default face it has. Naming a concrete family
 * here would force a bundled font decision that the resource pipeline has not
 * made yet.
 */
export const DEFAULT_FONT_FAMILY = 'sans-serif'

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: 11,
  fontWeight: 400,
  lineHeight: 1.5,
}

export function resolveTextStyle(style: TextStyle | null): TextStyle {
  return style ?? DEFAULT_TEXT_STYLE
}
