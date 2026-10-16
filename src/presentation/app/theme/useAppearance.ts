/**
 * @file useAppearance
 * @description Theme and colour-scheme preference, persisted to local storage
 * and written onto the document element, which is what the CSS selectors match.
 *
 * Constraints:
 * - The initial value is read once at module load so the first paint already
 *   has the right palette; a flash of the default theme is worse than a small
 *   synchronous read.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import {
  DEFAULT_THEME_ID,
  isThemeId,
  resolveColorScheme,
} from './themes'
import type { ColorScheme, ColorSchemePreference, ThemeId } from './themes'

const STORAGE_KEY = 'reresume.appearance'

interface AppearanceState {
  readonly themeId: ThemeId
  readonly colorSchemePreference: ColorSchemePreference
  setTheme(themeId: ThemeId): void
  setColorSchemePreference(preference: ColorSchemePreference): void
}

function readStoredAppearance(): { themeId: ThemeId; preference: ColorSchemePreference } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { themeId: DEFAULT_THEME_ID, preference: 'system' }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return { themeId: DEFAULT_THEME_ID, preference: 'system' }
    }
    const candidate = parsed as { themeId?: unknown; preference?: unknown }
    const themeId =
      typeof candidate.themeId === 'string' && isThemeId(candidate.themeId)
        ? candidate.themeId
        : DEFAULT_THEME_ID
    const preference =
      candidate.preference === 'light' ||
      candidate.preference === 'dark' ||
      candidate.preference === 'system'
        ? candidate.preference
        : 'system'
    return { themeId, preference }
  } catch {
    // A corrupt or unreadable entry must not stop the window from rendering.
    return { themeId: DEFAULT_THEME_ID, preference: 'system' }
  }
}

const initial = readStoredAppearance()

export const useAppearance = create<AppearanceState>((set, get) => ({
  themeId: initial.themeId,
  colorSchemePreference: initial.preference,
  setTheme(themeId) {
    set({ themeId })
    persist(get())
  },
  setColorSchemePreference(colorSchemePreference) {
    set({ colorSchemePreference })
    persist(get())
  },
}))

function persist(state: AppearanceState): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        themeId: state.themeId,
        preference: state.colorSchemePreference,
      }),
    )
  } catch {
    // Private-mode storage failures are not worth interrupting the user over;
    // the session keeps working, the choice just is not remembered.
  }
}

export function applyAppearance(themeId: ThemeId, scheme: ColorScheme): void {
  const root = document.documentElement
  root.setAttribute('data-theme', themeId)
  root.setAttribute('data-color-scheme', scheme)
  root.style.colorScheme = scheme
}

/** Mounted once by the shell. Keeps the document in sync with the store. */
export function useAppearanceEffect(): void {
  const themeId = useAppearance((state) => state.themeId)
  const preference = useAppearance((state) => state.colorSchemePreference)
  const scheme = resolveColorScheme(preference)

  useEffect(() => {
    applyAppearance(themeId, scheme)
  }, [themeId, scheme])

  useEffect(() => {
    if (preference !== 'system') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyAppearance(themeId, resolveColorScheme('system'))
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [themeId, preference])
}
