/**
 * @file providerStore
 * @description The configured model services as the conversation surface sees
 * them: the list, the one serving requests, and the result of the connectivity
 * test the model picker can run. Saving and deleting belong to the settings
 * surface; this store only reads and probes.
 *
 * Constraints:
 * - A probe result is session state: connectivity is a fact about this process's
 *   network, not a stored preference, so it is not persisted.
 * - The credential never enters this store; the probe runs behind the provider
 *   capability.
 */

import { create } from 'zustand'
import type { ProviderService } from '../../../../bootstrap/capabilities'
import type { ProviderListItem } from '../../../../application/settings/providerConfiguration'
import type { ProviderConnectionTestResult } from '../../../../application/settings/testProviderConnection'
import { describeError } from '../../../app/errorMessages'
import type { ReadableError } from '../../../app/errorMessages'

export type ProviderListStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface ProviderState {
  readonly providers: readonly ProviderListItem[]
  readonly activeProviderId: string | null
  readonly status: ProviderListStatus
  readonly error: ReadableError | null
  /** Probe results of this session, keyed by provider id. */
  readonly tested: Readonly<Record<string, ProviderConnectionTestResult>>
  readonly testing: ReadonlySet<string>
  connect(service: ProviderService | null): void
  refresh(): Promise<void>
  /** Switches the service that answers the assistant. The caller rebuilds the root. */
  setActive(providerId: string): Promise<boolean>
  testConnection(providerId: string): Promise<void>
  clearError(): void
}

let service: ProviderService | null = null
let generation = 0

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  activeProviderId: null,
  status: 'idle',
  error: null,
  tested: {},
  testing: new Set<string>(),

  connect(next) {
    if (service === next) return
    service = next
    generation += 1
    set({ providers: [], activeProviderId: null, status: 'idle', error: null, tested: {} })
    if (next !== null) void get().refresh()
  },

  async refresh() {
    const current = service
    if (current === null) return
    const request = generation + 1
    generation = request
    set({ status: 'loading' })
    try {
      const listed = await current.listProviders()
      if (request !== generation) return
      set({
        providers: listed.providers,
        activeProviderId: listed.activeProviderId,
        status: 'ready',
        error: null,
      })
    } catch (failure) {
      if (request !== generation) return
      set({ status: 'failed', error: describeError(failure) })
    }
  },

  async setActive(providerId) {
    const current = service
    if (current === null) return false
    try {
      await current.setActiveProvider({ id: providerId })
      await get().refresh()
      return true
    } catch (failure) {
      set({ error: describeError(failure) })
      return false
    }
  },

  async testConnection(providerId) {
    const current = service
    if (current === null || get().testing.has(providerId)) return
    set((state) => ({ testing: new Set(state.testing).add(providerId) }))
    try {
      const result = await current.testProviderConnection({ id: providerId })
      set((state) => ({
        tested: { ...state.tested, [providerId]: result },
        testing: without(state.testing, providerId),
      }))
    } catch (failure) {
      set((state) => ({
        error: describeError(failure),
        testing: without(state.testing, providerId),
      }))
    }
  },

  clearError() {
    set({ error: null })
  },
}))

function without(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set)
  next.delete(value)
  return next
}
