/**
 * @file setActiveProvider
 * @description Switches which model service answers the assistant.
 *
 * Responsibilities:
 * - Claim the row and clear the previous claim in one repository transaction
 * - Record the same choice in the settings row the startup path reads
 * - Put the previous provider back when the setting cannot be written, so the
 *   two stores do not disagree about which service is serving
 *
 * Constraints:
 * - The provider row and the settings row are two ports, so "one transaction"
 *   spans them only through this compensating write. The database trigger that
 *   keeps one active row is what makes the intermediate state harmless.
 */

import type { ProviderConfig } from '../../domain/settings/ProviderConfig'
import { saveAppSettings } from './saveAppSettings'
import { providerNotFound } from './providerConfiguration'
import type { ProviderConfigurationDeps } from './providerConfiguration'

export interface SetActiveProviderInput {
  readonly id: string
}

export async function setActiveProvider(
  deps: ProviderConfigurationDeps,
  input: SetActiveProviderInput,
): Promise<ProviderConfig> {
  const config = await deps.providers.findById(input.id)
  if (config === null) throw providerNotFound(input.id)
  const previous = await deps.providers.findActive()
  await deps.providers.setActive(config.id)
  try {
    await saveAppSettings({ settings: deps.settings }, { activeProviderId: config.id })
  } catch (failure) {
    await deps.providers.setActive(previous?.id ?? null)
    throw failure
  }
  return { ...config, isActive: true }
}
