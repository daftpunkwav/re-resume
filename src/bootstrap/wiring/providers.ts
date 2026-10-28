/**
 * @file providers wiring
 * @description Assembles the model-service use cases: the saved rows, the secure
 * store, the settings row that records which service is active, and the adapter
 * factory the connection test needs.
 *
 * Constraints:
 * - This module only assembles: validation and ordering rules live in the use
 *   cases.
 * - The adapter factory is handed in by the composition root, so this file never
 *   constructs an HTTP client or a vendor adapter.
 */

import type { ProviderService } from '../capabilities'
import { deleteProvider } from '../../application/settings/deleteProvider'
import { listProviders } from '../../application/settings/listProviders'
import { saveProvider } from '../../application/settings/saveProvider'
import { setActiveProvider } from '../../application/settings/setActiveProvider'
import { testProviderConnection } from '../../application/settings/testProviderConnection'
import type { ProviderFactory } from '../../application/settings/testProviderConnection'
import type { ProviderConfigurationDeps } from '../../application/settings/providerConfiguration'

export interface ProviderWiring extends ProviderConfigurationDeps {
  readonly createProvider: ProviderFactory
}

export function createProviderService(wiring: ProviderWiring): ProviderService {
  const deps: ProviderConfigurationDeps = {
    providers: wiring.providers,
    settings: wiring.settings,
    secrets: wiring.secrets,
    clock: wiring.clock,
    ids: wiring.ids,
  }
  return {
    listProviders: () => listProviders(deps),
    saveProvider: (input) => saveProvider(deps, input),
    deleteProvider: (input) => deleteProvider(deps, input),
    setActiveProvider: (input) => setActiveProvider(deps, input),
    testProviderConnection: (input) =>
      testProviderConnection({ ...deps, createProvider: wiring.createProvider }, input),
  }
}
