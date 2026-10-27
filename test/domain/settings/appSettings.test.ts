/**
 * @file appSettings.test
 * @description The closed enumerations, the ranges and the clamping the rest
 * of the window relies on. The clamp functions are the only place a numeric
 * preference becomes a legal value.
 */

import { describe, expect, it } from 'vitest'

import {
  clampCanvasZoom,
  clampPanelWidth,
  clampUiScale,
  DEFAULT_APP_SETTINGS,
  isAppSettings,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from '../../../src/domain/settings/AppSettings'

describe('AppSettings', () => {
  it('starts from defaults that validate', () => {
    expect(isAppSettings(DEFAULT_APP_SETTINGS)).toBe(true)
  })

  it('clamps the interface scale into range and onto its step', () => {
    expect(clampUiScale(0.2)).toBe(UI_SCALE_MIN)
    expect(clampUiScale(9)).toBe(UI_SCALE_MAX)
    expect(clampUiScale(1.03)).toBe(1)
    expect(clampUiScale(1.06)).toBe(1.1)
    expect(clampUiScale(1.36)).toBe(1.4)
  })

  it('falls back to 100% for a value that is not a number', () => {
    expect(clampUiScale(Number.NaN)).toBe(1)
    expect(clampUiScale(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('clamps the panel width into range and rounds to whole pixels', () => {
    expect(clampPanelWidth(100)).toBe(PANEL_WIDTH_MIN)
    expect(clampPanelWidth(2000)).toBe(PANEL_WIDTH_MAX)
    expect(clampPanelWidth(420.4)).toBe(420)
    // The narrow layout has its own ceiling.
    expect(clampPanelWidth(700, 420)).toBe(420)
  })

  it('clamps the canvas zoom into range', () => {
    expect(clampCanvasZoom(0.1)).toBe(0.25)
    expect(clampCanvasZoom(10)).toBe(3)
    expect(clampCanvasZoom(1.234)).toBe(1.23)
  })

  it('rejects a stored value that is not one of the legal enumerations', () => {
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, themeId: 'unknown' })).toBe(false)
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, colorScheme: 'sepia' })).toBe(false)
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, density: 'large' })).toBe(false)
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, motion: 'none' })).toBe(false)
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, panels: { right: 'left', rightWidth: 400, collapsed: false } })).toBe(false)
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, panels: { right: 'none', rightWidth: 10, collapsed: false } })).toBe(false)
  })

  it('rejects a stored value whose ranges are outside the contract', () => {
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, uiScale: 3 })).toBe(false)
    expect(isAppSettings({ ...DEFAULT_APP_SETTINGS, canvasZoom: 0 })).toBe(false)
    expect(isAppSettings(null)).toBe(false)
    expect(isAppSettings([])).toBe(false)
  })
})
