/**
 * @file tokens
 * @description Helpers the bundled templates share: text token construction,
 * appearance defaults and page defaults. They keep the six template files
 * declarative; no template invents a value the others cannot read.
 *
 * Constraints:
 * - The bundled family is the only font family available, so every token names
 *   it (spec section 11.1: a token family must exist in the font registry).
 * - Pure data: no DOM, no storage, no package.
 */

import { DEFAULT_FONT_FAMILY } from '../TextStyle'
import type {
  AppearanceSettings,
  AccentColor,
  HeadingStyle,
} from '../AppearanceSettings'
import type { PageSetup } from '../PageSetup'
import type { TextStyleToken } from '../Template'

/** One text role's base style. */
export function styleToken(
  fontSize: number,
  fontWeight: 400 | 700 = 400,
  lineHeight = 1.4,
): TextStyleToken {
  return { fontFamily: DEFAULT_FONT_FAMILY, fontSize, fontWeight, lineHeight }
}

/** Appearance defaults for one template. */
export function appearanceFor(
  accentColor: AccentColor,
  headingStyle: HeadingStyle,
  sectionSpacing: number,
  lineHeight = 1.5,
): AppearanceSettings {
  return {
    accentColor,
    fontPairId: 'default',
    fontScale: 1,
    lineHeight,
    sectionSpacing,
    headingStyle,
  }
}

/** Page defaults for one template; all margins are equal unless overridden. */
export function pageSetupFor(
  margin: number,
  columns: 1 | 2,
  overrides: Partial<PageSetup> = {},
): PageSetup {
  return {
    paper: 'A4',
    marginTop: margin,
    marginRight: margin,
    marginBottom: margin,
    marginLeft: margin,
    columns,
    showPageNumber: false,
    ...overrides,
  }
}
