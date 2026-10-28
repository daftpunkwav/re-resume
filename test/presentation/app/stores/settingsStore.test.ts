/**
 * @file settingsStore.test
 * @description The one writer of the preferences: a change is applied to the
 * document at once, mirrored into the first-paint cache, and stored once its
 * debounce expires. A failed write is reported without reverting the window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_APP_SETTINGS,
} from '../../../../src/domain/settings/AppSettings'
import {
  SETTINGS_SAVE_DEBOUNCE_MS,
  useSettingsStore,
} from '../../../../src/presentation/app/stores/settingsStore'
import { SETTINGS_CACHE_KEY } from '../../../../src/presentation/app/theme/settingsCache'

function resetStore(): void {
  useSettingsStore.setState({
    settings: DEFAULT_APP_SETTINGS,
    status: 'ready',
    error: null,
  })
}

beforeEach(() => {
  resetStore()
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-color-scheme')
  document.documentElement.removeAttribute('data-density')
  document.documentElement.removeAttribute('data-motion')
  document.documentElement.style.removeProperty('--ui-scale')
  document.documentElement.style.removeProperty('--density')
})

describe('useSettingsStore', () => {
  it('applies a change to the document before it is stored', () => {
    vi.useFakeTimers()
    const save = vi.fn(async (patch) => ({ ...DEFAULT_APP_SETTINGS, ...patch }))
    useSettingsStore.getState().connect(save)

    useSettingsStore.getState().update({ uiScale: 1.2, density: 'compact' })

    expect(useSettingsStore.getState().settings.uiScale).toBe(1.2)
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.2')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
    expect(save).not.toHaveBeenCalled()
  })

  it('mirrors the change into the first-paint cache', () => {
    vi.useFakeTimers()
    useSettingsStore.getState().connect(async (patch) => ({ ...DEFAULT_APP_SETTINGS, ...patch }))

    useSettingsStore.getState().update({ themeId: 'trae' })

    const cached: unknown = JSON.parse(window.localStorage.getItem(SETTINGS_CACHE_KEY) ?? 'null')
    expect(cached).toMatchObject({ themeId: 'trae' })
  })

  it('stores a burst of changes once, after the debounce', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (patch) => ({ ...DEFAULT_APP_SETTINGS, ...patch }))
    useSettingsStore.getState().connect(save)

    useSettingsStore.getState().update({ uiScale: 1.1 })
    useSettingsStore.getState().update({ uiScale: 1.2 })
    useSettingsStore.getState().update({ uiScale: 1.3 })

    await vi.advanceTimersByTimeAsync(SETTINGS_SAVE_DEBOUNCE_MS + 10)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ uiScale: 1.3 }))
  })

  it('clamps a value before it reaches the document', () => {
    vi.useFakeTimers()
    useSettingsStore.getState().connect(async (patch) => ({ ...DEFAULT_APP_SETTINGS, ...patch }))

    useSettingsStore.getState().update({ uiScale: 9 })

    expect(useSettingsStore.getState().settings.uiScale).toBe(1.4)
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.4')
  })

  it('reports a failed write and keeps the applied value', async () => {
    vi.useFakeTimers()
    useSettingsStore.getState().connect(async () => {
      throw new Error('磁盘已满')
    })

    useSettingsStore.getState().update({ uiScale: 1.1 })
    await vi.advanceTimersByTimeAsync(SETTINGS_SAVE_DEBOUNCE_MS + 10)

    expect(useSettingsStore.getState().error?.message).toContain('磁盘已满')
    expect(useSettingsStore.getState().settings.uiScale).toBe(1.1)
  })

  it('adopts the stored value and marks the settings ready', () => {
    const stored = { ...DEFAULT_APP_SETTINGS, themeId: 'google' as const }

    useSettingsStore.getState().adopt(stored)

    expect(useSettingsStore.getState()).toMatchObject({ settings: stored, status: 'ready' })
    expect(document.documentElement.getAttribute('data-theme')).toBe('google')
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_CACHE_KEY) ?? 'null')).toEqual(stored)
  })

  it('keeps the cache serving when the stored value cannot be read', () => {
    useSettingsStore.getState().failRead(new Error('设置行损坏'))

    expect(useSettingsStore.getState()).toMatchObject({
      settings: DEFAULT_APP_SETTINGS,
      status: 'unavailable',
    })
    expect(useSettingsStore.getState().error?.message).toContain('设置行损坏')
  })
})
