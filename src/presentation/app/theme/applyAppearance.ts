/**
 * @file applyAppearance
 * @description Writes the preferences onto the document element. The
 * stylesheets select on these attributes and read the scale custom property,
 * so applying a setting is one DOM write and no component re-render.
 *
 * Responsibilities:
 * - Set data-theme, data-color-scheme, data-density and data-motion
 * - Set --ui-scale and --density, the two multipliers every size derives from
 *
 * Constraints:
 * - Called synchronously before the first render, so the first paint already
 *   carries the saved palette and scale.
 * - No React state lives here: this is the boundary between the settings value
 *   and the document.
 */

import { resolveColorScheme } from './themes'
import type { AppSettings } from '../../../domain/settings/AppSettings'

/** Density factor the stylesheet multiplies control sizes by. */
const DENSITY_FACTORS = { comfortable: 1, compact: 0.85 } as const

export function applyAppearance(settings: AppSettings): void {
  const root = document.documentElement
  const scheme = resolveColorScheme(settings.colorScheme)

  root.setAttribute('data-theme', settings.themeId)
  root.setAttribute('data-color-scheme', scheme)
  root.setAttribute('data-density', settings.density)
  root.setAttribute('data-motion', settings.motion)
  root.style.colorScheme = scheme
  root.style.setProperty('--ui-scale', String(settings.uiScale))
  root.style.setProperty('--density', String(DENSITY_FACTORS[settings.density]))
}
