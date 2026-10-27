/**
 * @file settingsCache.test
 * @description The first-paint mirror: a written value reads back, and any
 * entry this build cannot validate falls back to the defaults instead of
 * breaking the first paint.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import {
  readCachedSettings,
  SETTINGS_CACHE_KEY,
  writeCachedSettings,
} from '../../../../src/presentation/app/theme/settingsCache'

beforeEach(() => {
  window.localStorage.clear()
})

describe('settingsCache', () => {
  it('reads back what it wrote', () => {
    const stored = { ...DEFAULT_APP_SETTINGS, uiScale: 1.3, density: 'compact' as const }
    writeCachedSettings(stored)

    expect(readCachedSettings()).toEqual(stored)
  })

  it('falls back to the defaults when nothing was cached', () => {
    expect(readCachedSettings()).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('falls back to the defaults when the entry is not JSON', () => {
    window.localStorage.setItem(SETTINGS_CACHE_KEY, '{not json')
    expect(readCachedSettings()).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('falls back to the defaults when the entry is not a settings value', () => {
    window.localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({ themeId: 'apple' }))
    expect(readCachedSettings()).toEqual(DEFAULT_APP_SETTINGS)
  })
})
