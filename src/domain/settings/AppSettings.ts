/**
 * @file AppSettings
 * @description The user's interface preferences: palette, colour scheme,
 * density, motion, interface scale, canvas zoom and the panel layout. One
 * value of this type is the single truth; the local-storage mirror read at the
 * first paint is a cache of it.
 *
 * Responsibilities:
 * - Declare the closed enumerations and numeric ranges of the preferences
 * - Provide the defaults used before anything has been stored
 * - Clamp and validate values at the boundary, so callers never hand a
 *   half-validated preference through
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - Changes to the shape or to a range are a contract change for the
 *   persistence row and the settings cache; both carry a version.
 */

import type { ConversationId } from '../shared/branded-id'

export const THEME_IDS = ['apple', 'doubao', 'google', 'minimalist', 'trae'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export const COLOR_SCHEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** 'system' follows the operating system until the user picks a side. */
export type ColorSchemePreference = (typeof COLOR_SCHEME_PREFERENCES)[number]

export type ColorScheme = Exclude<ColorSchemePreference, 'system'>

export const DENSITIES = ['comfortable', 'compact'] as const

export type Density = (typeof DENSITIES)[number]

export const MOTION_PREFERENCES = ['system', 'reduced'] as const

/** 'system' honours prefers-reduced-motion; 'reduced' forces it off. */
export type MotionPreference = (typeof MOTION_PREFERENCES)[number]

export const PANEL_MODES = ['none', 'resume', 'info', 'both'] as const

export type PanelMode = (typeof PANEL_MODES)[number]

export interface PanelPreferences {
  /** Which right-hand panels are open; persisted across launches. */
  readonly right: PanelMode
  /** Width of the right-hand panel region in CSS pixels, 320..720. */
  readonly rightWidth: number
  /** Whether the user collapsed the sidebar themselves. */
  readonly collapsed: boolean
}

export interface AppSettings {
  readonly themeId: ThemeId
  readonly colorScheme: ColorSchemePreference
  readonly density: Density
  readonly motion: MotionPreference
  /** Interface scale, 0.8..1.4 in steps of 0.1. */
  readonly uiScale: number
  /** Zoom of the resume canvas, independent of the interface scale. */
  readonly canvasZoom: number
  readonly panels: PanelPreferences
  readonly sampleDataSeeded: boolean
  readonly lastConversationId: ConversationId | null
  readonly activeProviderId: string | null
}

export const UI_SCALE_MIN = 0.8
export const UI_SCALE_MAX = 1.4
export const UI_SCALE_STEP = 0.1

export const PANEL_WIDTH_MIN = 320
export const PANEL_WIDTH_MAX = 720
/** The width ceiling while the window is narrower than the wide breakpoint. */
export const PANEL_WIDTH_NARROW_MAX = 420
export const PANEL_WIDTH_DEFAULT = 400

export const CANVAS_ZOOM_MIN = 0.25
export const CANVAS_ZOOM_MAX = 3

export const DEFAULT_APP_SETTINGS: AppSettings = {
  themeId: 'apple',
  colorScheme: 'system',
  density: 'comfortable',
  motion: 'system',
  uiScale: 1,
  canvasZoom: 1,
  panels: { right: 'none', rightWidth: PANEL_WIDTH_DEFAULT, collapsed: false },
  sampleDataSeeded: false,
  lastConversationId: null,
  activeProviderId: null,
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/**
 * Rounds to the nearest scale step and clamps into range. The scale slider,
 * the keyboard shortcuts and a stored value all pass through this, so the
 * document only ever carries one of the eight legal factor values.
 */
export function clampUiScale(value: number): number {
  const finite = finiteOr(value, 1)
  const stepped = Math.round(finite / UI_SCALE_STEP) * UI_SCALE_STEP
  // Floating point: 1.3000000000000003 must not reach the stylesheet.
  const rounded = Math.round(stepped * 10) / 10
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, rounded))
}

export function clampPanelWidth(value: number, max = PANEL_WIDTH_MAX): number {
  const finite = finiteOr(value, PANEL_WIDTH_DEFAULT)
  return Math.min(max, Math.max(PANEL_WIDTH_MIN, Math.round(finite)))
}

export function clampCanvasZoom(value: number): number {
  const finite = finiteOr(value, 1)
  const rounded = Math.round(finite * 100) / 100
  return Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, rounded))
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
}

export function isColorSchemePreference(value: unknown): value is ColorSchemePreference {
  return (
    typeof value === 'string' &&
    (COLOR_SCHEME_PREFERENCES as readonly string[]).includes(value)
  )
}

export function isDensity(value: unknown): value is Density {
  return typeof value === 'string' && (DENSITIES as readonly string[]).includes(value)
}

export function isMotionPreference(value: unknown): value is MotionPreference {
  return (
    typeof value === 'string' && (MOTION_PREFERENCES as readonly string[]).includes(value)
  )
}

export function isPanelMode(value: unknown): value is PanelMode {
  return typeof value === 'string' && (PANEL_MODES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPanelPreferences(value: unknown): value is PanelPreferences {
  if (!isRecord(value)) return false
  const width = value.rightWidth
  return (
    isPanelMode(value.right) &&
    typeof value.collapsed === 'boolean' &&
    typeof width === 'number' &&
    Number.isFinite(width) &&
    width >= PANEL_WIDTH_MIN &&
    width <= PANEL_WIDTH_MAX
  )
}

/**
 * Shape and range check for a stored value. A row that fails this is not the
 * settings this build wrote, so the persistence layer refuses it rather than
 * silently substituting defaults for a value the user chose.
 */
export function isAppSettings(value: unknown): value is AppSettings {
  if (!isRecord(value)) return false
  return (
    isThemeId(value.themeId) &&
    isColorSchemePreference(value.colorScheme) &&
    isDensity(value.density) &&
    isMotionPreference(value.motion) &&
    typeof value.uiScale === 'number' &&
    Number.isFinite(value.uiScale) &&
    value.uiScale >= UI_SCALE_MIN &&
    value.uiScale <= UI_SCALE_MAX &&
    typeof value.canvasZoom === 'number' &&
    Number.isFinite(value.canvasZoom) &&
    value.canvasZoom >= CANVAS_ZOOM_MIN &&
    value.canvasZoom <= CANVAS_ZOOM_MAX &&
    isPanelPreferences(value.panels) &&
    typeof value.sampleDataSeeded === 'boolean' &&
    (value.lastConversationId === null || typeof value.lastConversationId === 'string') &&
    (value.activeProviderId === null || typeof value.activeProviderId === 'string')
  )
}
