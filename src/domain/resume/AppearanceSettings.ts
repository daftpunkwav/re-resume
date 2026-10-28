/**
 * @file AppearanceSettings
 * @description The look of one resume: accent colour, font pair, type scale,
 * line height, section spacing and heading treatment. Appearance is document
 * state (it travels through the revision chain), so every value is validated by
 * the closed rules declared here.
 *
 * Responsibilities:
 * - Declare the closed option sets the interface and the validator share
 * - Declare the bounds every numeric option must satisfy
 * - Resolve a font pair to the family the measurer and the renderers use
 * - Provide the accent colour table the renderers map to hex values
 *
 * Constraints:
 * - Pure data: no DOM, no storage, no package.
 * - Bounds are inclusive and the error code is always `invalidSettings`.
 */

import { DomainError } from '../shared/DomainError'
import { DEFAULT_FONT_FAMILY } from './TextStyle'

export const ACCENT_COLORS = ['ink', 'blue', 'teal', 'green', 'amber', 'rose'] as const
export type AccentColor = (typeof ACCENT_COLORS)[number]

/**
 * Only the bundled family is offered: a second pair would need a second font
 * asset, and a value the registry cannot measure would move every line break.
 */
export const FONT_PAIRS = ['default'] as const
export type FontPairId = (typeof FONT_PAIRS)[number]

export const HEADING_STYLES = ['plain', 'accentBar', 'underline', 'boxed'] as const
export type HeadingStyle = (typeof HEADING_STYLES)[number]

export interface AppearanceSettings {
  readonly accentColor: AccentColor
  readonly fontPairId: FontPairId
  /** Multiplier of every template font size: 0.85..1.25 in steps of 0.05. */
  readonly fontScale: number
  /** Multiple of the font size: 1.15..2.0. */
  readonly lineHeight: number
  /** Space before a section, in points: 8..48. */
  readonly sectionSpacing: number
  readonly headingStyle: HeadingStyle
}

export const FONT_SCALE_MIN = 0.85
export const FONT_SCALE_MAX = 1.25
export const FONT_SCALE_STEP = 0.05
export const LINE_HEIGHT_MIN = 1.15
export const LINE_HEIGHT_MAX = 2
export const SECTION_SPACING_MIN = 8
export const SECTION_SPACING_MAX = 48

/** The family a font pair resolves to. */
export function fontPairFamily(pairId: FontPairId): string {
  switch (pairId) {
    case 'default':
      return DEFAULT_FONT_FAMILY
  }
}

function invalidAppearance(field: string, reason: string): DomainError {
  return new DomainError('invalidSettings', `The appearance field "${field}" ${reason}.`, {
    entity: 'appearance',
    id: field,
    blockers: [field],
  })
}

function assertMember<T extends string>(
  field: string,
  value: unknown,
  members: readonly T[],
): asserts value is T {
  if (typeof value !== 'string' || !(members as readonly string[]).includes(value)) {
    throw invalidAppearance(field, `must be one of ${members.join(', ')}`)
  }
}

function assertRange(field: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidAppearance(field, `must be between ${minimum.toString()} and ${maximum.toString()}`)
  }
}

/**
 * Validates every field of one appearance value. Callers that patch a subset
 * merge first; this function is the single place the bounds are stated.
 *
 * @throws DomainError `invalidSettings` for an unknown option or an out-of-range
 *   number.
 */
export function assertAppearance(appearance: AppearanceSettings): void {
  assertMember('accentColor', appearance.accentColor, ACCENT_COLORS)
  assertMember('fontPairId', appearance.fontPairId, FONT_PAIRS)
  assertRange('fontScale', appearance.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX)
  const steps = appearance.fontScale / FONT_SCALE_STEP
  if (Math.abs(steps - Math.round(steps)) > 1e-9) {
    throw invalidAppearance('fontScale', `must move in steps of ${FONT_SCALE_STEP.toString()}`)
  }
  assertRange('lineHeight', appearance.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX)
  assertRange(
    'sectionSpacing',
    appearance.sectionSpacing,
    SECTION_SPACING_MIN,
    SECTION_SPACING_MAX,
  )
  assertMember('headingStyle', appearance.headingStyle, HEADING_STYLES)
}

/**
 * Applies a partial patch over the current appearance and validates the result.
 * The patch is untrusted input, so the merged value is what gets checked.
 *
 * @throws DomainError `invalidSettings`.
 */
export function mergeAppearance(
  current: AppearanceSettings,
  patch: Partial<AppearanceSettings>,
): AppearanceSettings {
  const merged: AppearanceSettings = { ...current, ...patch }
  assertAppearance(merged)
  return merged
}
