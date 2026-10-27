/**
 * @file settingsStore
 * @description Holds the applied interface preferences and is the only place
 * that writes them. A change is applied to the document immediately, mirrored
 * into the first-paint cache, and stored after a short debounce.
 *
 * Responsibilities:
 * - Adopt the stored value once the composition root is ready (the database wins)
 * - Merge a change locally, apply it, and persist it as one debounced write
 * - Report a failed write without reverting what the user sees, so the window
 *   keeps working and the failure is shown where the setting lives
 *
 * Constraints:
 * - Never reads storage directly: the cache is written here through the cache
 *   module, the truth arrives through the composition root.
 * - Numeric ranges are clamped here as well as in the use case: the store
 *   applies values before the round trip, so an unclamped value would reach
 *   the document and the cache.
 */

import { create } from 'zustand'
import {
  clampCanvasZoom,
  clampPanelWidth,
  clampUiScale,
  DEFAULT_APP_SETTINGS,
} from '../../../domain/settings/AppSettings'
import type { AppSettings, PanelPreferences } from '../../../domain/settings/AppSettings'
import { describeError } from '../errorMessages'
import type { ReadableError } from '../errorMessages'
import { applyAppearance } from '../theme/applyAppearance'
import { readCachedSettings, writeCachedSettings } from '../theme/settingsCache'

/** How long a burst of changes (a slider drag, a held shortcut) is coalesced. */
export const SETTINGS_SAVE_DEBOUNCE_MS = 300

export type SettingsStatus = 'connecting' | 'ready' | 'unavailable'

/** The root's save function, handed over when the window boots. */
export type SettingsWriter = (patch: Partial<AppSettings>) => Promise<AppSettings>

interface SettingsState {
  readonly settings: AppSettings
  readonly status: SettingsStatus
  readonly error: ReadableError | null
  /** Attaches the save function the composition root exposes. */
  connect(writer: SettingsWriter): void
  /** Adopts the stored value; the database is the truth, the cache only previews it. */
  adopt(settings: AppSettings): void
  /** Records that the stored value could not be read; the cache keeps serving. */
  failRead(error: unknown): void
  update(patch: Partial<AppSettings>): void
  clearError(): void
}

/** Merge that keeps the ranges legal before the round trip. */
function mergePatch(current: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const panels: PanelPreferences =
    patch.panels === undefined
      ? current.panels
      : {
          right: patch.panels.right,
          rightWidth: clampPanelWidth(patch.panels.rightWidth),
          collapsed: patch.panels.collapsed,
        }
  return {
    ...current,
    ...patch,
    uiScale: patch.uiScale === undefined ? current.uiScale : clampUiScale(patch.uiScale),
    canvasZoom:
      patch.canvasZoom === undefined ? current.canvasZoom : clampCanvasZoom(patch.canvasZoom),
    panels,
  }
}

let writer: SettingsWriter | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** Counts requested writes; a settling write older than the newest one is stale. */
let saveGeneration = 0

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushSave()
  }, SETTINGS_SAVE_DEBOUNCE_MS)
}

async function flushSave(): Promise<void> {
  if (writer === null) return
  saveGeneration += 1
  const generation = saveGeneration
  const patch = useSettingsStore.getState().settings
  try {
    const stored = await writer(patch)
    // A newer change arrived while this write was in flight: its own write is
    // queued, and adopting this answer would flash the old value back.
    if (generation !== saveGeneration) return
    useSettingsStore.setState((state) => ({
      settings: stored,
      error: null,
      status: state.status === 'connecting' ? 'ready' : state.status,
    }))
  } catch (failure) {
    if (generation !== saveGeneration) return
    useSettingsStore.setState({ error: describeError(failure) })
  }
}

/** Initial value: the cache, so the first paint and the store agree. */
const initial = readCachedSettings()

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: initial,
  status: 'connecting',
  error: null,
  connect(nextWriter) {
    writer = nextWriter
  },
  adopt(settings) {
    set({ settings, status: 'ready', error: null })
    applyAppearance(settings)
    writeCachedSettings(settings)
  },
  failRead(failure) {
    set({ status: 'unavailable', error: describeError(failure) })
  },
  update(patch) {
    const settings = mergePatch(get().settings, patch)
    set({ settings })
    applyAppearance(settings)
    writeCachedSettings(settings)
    scheduleSave()
  },
  clearError() {
    set({ error: null })
  },
}))

/** The value without subscribing, for boot code that applies it before mounting. */
export function currentSettings(): AppSettings {
  return useSettingsStore.getState().settings
}

export { DEFAULT_APP_SETTINGS }
