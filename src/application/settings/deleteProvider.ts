/**
 * @file deleteProvider
 * @description Removes a model-service configuration, its credential and, when
 * it was serving requests, the active-provider setting.
 *
 * Constraints:
 * - The active setting is cleared before the row disappears: a setting naming a
 *   missing row would make the next boot resolve the provider list twice for
 *   different answers.
 * - The credential is removed after the row. A failure to erase an orphaned
 *   secret is reported, but the configuration the user asked to delete is gone
 *   either way; leaving the row behind instead would keep a credential the user
 *   cannot reach.
 */

import { saveAppSettings } from './saveAppSettings'
import { providerNotFound } from './providerConfiguration'
import type { ProviderConfigurationDeps } from './providerConfiguration'

export interface DeleteProviderInput {
  readonly id: string
}

export async function deleteProvider(
  deps: ProviderConfigurationDeps,
  input: DeleteProviderInput,
): Promise<void> {
  const config = await deps.providers.findById(input.id)
  if (config === null) throw providerNotFound(input.id)
  if (config.isActive) {
    await deps.providers.setActive(null)
    const stored = await deps.settings.read()
    if (stored?.activeProviderId !== null) {
      await saveAppSettings({ settings: deps.settings }, { activeProviderId: null })
    }
  }
  await deps.providers.delete(config.id)
  await deps.secrets.remove(config.secretRef)
}
