/**
 * @file listProviders
 * @description Lists the configured model services for the model picker and the
 * settings list, together with the one currently serving requests.
 *
 * Constraints:
 * - A row is not a usable service until its credential is stored; the list says
 *   so per row instead of hiding the row, because the user still has to edit it.
 * - The active provider is the settings value; a row flagged active whose
 *   setting was cleared is reported through the row instead of being promoted.
 */

import type { ProviderConfigurationDeps, ListProvidersOutput } from './providerConfiguration'
import { readProviderCredential } from './providerConfiguration'

export async function listProviders(
  deps: ProviderConfigurationDeps,
): Promise<ListProvidersOutput> {
  const configs = await deps.providers.listAll()
  const stored = await deps.settings.read()
  const activeProviderId =
    stored?.activeProviderId ?? configs.find((config) => config.isActive)?.id ?? null
  const providers = []
  for (const config of configs) {
    providers.push({
      config,
      hasCredential: (await readProviderCredential(deps, config)) !== null,
    })
  }
  return { providers, activeProviderId }
}
