/**
 * @file settingsCache
 * @description The first-paint mirror of the settings row. The window reads it
 * synchronously before React mounts, applies it, and then the database value
 * replaces it once the composition root is ready.
 *
 * Responsibilities:
 * - Read and validate the cached preferences
 * - Write the cache whenever the database accepted a change
 *
 * Constraints:
 * - The cache never wins over the database: a value here is only applied until
 *   the stored settings are read.
 * - A corrupt or older entry falls back to the defaults rather than throwing:
 *   the first paint must not depend on storage being readable.
 */

import { DEFAULT_APP_SETTINGS, isAppSettings } from '../../../domain/settings/AppSettings'
import type { AppSettings } from '../../../domain/settings/AppSettings'

/** Versioned key: a future shape change reads as absent instead of as garbage. */
export const SETTINGS_CACHE_KEY = 'reresume.settings.cache.v2'

export function readCachedSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_CACHE_KEY)
    if (raw === null) return DEFAULT_APP_SETTINGS
    const parsed: unknown = JSON.parse(raw)
    return isAppSettings(parsed) ? parsed : DEFAULT_APP_SETTINGS
  } catch {
    // Unreadable storage and malformed JSON are the same case here: the
    // defaults are a valid temporary value and the database value follows.
    return DEFAULT_APP_SETTINGS
  }
}

export function writeCachedSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings))
  } catch {
    // Private-mode storage failures are not worth interrupting the user over;
    // the session keeps working, the choice is just not remembered early.
  }
}
