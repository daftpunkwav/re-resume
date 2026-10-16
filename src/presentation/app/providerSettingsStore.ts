/**
 * @file providerSettingsStore
 * @description Where the model service configuration lives.
 *
 * The descriptor is ordinary settings and is persisted. The vault password is
 * not: it unlocks the encrypted store and stays in memory for the session, so
 * closing the application discards it.
 */

import { create } from 'zustand'
import type { ProviderDescriptor } from '../../bootstrap/compositionRoot'

const STORAGE_KEY = 'reresume.provider'

export type ProviderKind = 'openai-compatible' | 'anthropic'

export interface ProviderSettings {
  readonly kind: ProviderKind
  readonly id: string
  readonly modelId: string
  readonly baseUrl: string
  readonly apiKeyRef: string
}

interface ProviderSettingsState {
  readonly settings: ProviderSettings | null
  /** Session-only. Never written to storage. */
  readonly vaultPassword: string
  saveSettings(settings: ProviderSettings): void
  clearSettings(): void
  unlockVault(password: string): void
}

function readStoredSettings(): ProviderSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Partial<ProviderSettings>
    if (
      (candidate.kind !== 'openai-compatible' && candidate.kind !== 'anthropic') ||
      typeof candidate.id !== 'string' ||
      typeof candidate.modelId !== 'string' ||
      typeof candidate.baseUrl !== 'string' ||
      typeof candidate.apiKeyRef !== 'string'
    ) {
      return null
    }
    return candidate as ProviderSettings
  } catch {
    // Corrupt settings must not stop the window from rendering.
    return null
  }
}

export const useProviderSettings = create<ProviderSettingsState>((set) => ({
  settings: readStoredSettings(),
  vaultPassword: '',
  saveSettings(settings) {
    set({ settings })
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // The session keeps working; only the preference is lost on restart.
    }
  },
  clearSettings() {
    set({ settings: null })
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Nothing further to do; the in-memory value is already cleared.
    }
  },
  unlockVault(vaultPassword) {
    set({ vaultPassword })
  },
}))

export function toProviderDescriptor(
  settings: ProviderSettings | null,
): ProviderDescriptor | null {
  return settings
}
