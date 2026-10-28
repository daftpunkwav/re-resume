/**
 * @file saveProvider
 * @description Creates or updates one model-service configuration and stores its
 * credential in the secure store. The database row keeps only the reference.
 *
 * Responsibilities:
 * - Validate name, endpoint, kind and model name
 * - Generate the identifier of a new row and keep the creation time of an
 *   existing one
 * - Write a submitted key to the secure store and never echo it back
 * - Make the first provider active, so a window with one configuration can talk
 *   to the assistant without a second step
 *
 * Constraints:
 * - `apiKey` omitted means "keep the stored credential"; the settings form does
 *   not receive the key back and therefore cannot resend it.
 * - The row is written before the setting that activates it: an active setting
 *   that names no row would resolve to the unconfigured provider on reboot.
 */

import { providerSecretRef } from '../../domain/settings/ProviderConfig'
import type { ProviderConfig } from '../../domain/settings/ProviderConfig'
import { saveAppSettings } from './saveAppSettings'
import {
  normaliseBaseUrl,
  normaliseModelId,
  normaliseProviderName,
  providerNotFound,
  requireProviderKind,
} from './providerConfiguration'
import type { ProviderConfigurationDeps, SavedProvider } from './providerConfiguration'
import { readProviderCredential } from './providerConfiguration'

export interface SaveProviderInput {
  /** Present when editing; absent when creating. */
  readonly id?: string | null
  readonly name: string
  readonly kind: string
  readonly baseUrl: string
  readonly modelId: string
  /**
   * The key to store. Omitted keeps the credential already stored for this
   * provider; an empty value is treated as omitted.
   */
  readonly apiKey?: string
  /** null = infer from the kind and the model name. */
  readonly supportsImages?: boolean | null
}

export async function saveProvider(
  deps: ProviderConfigurationDeps,
  input: SaveProviderInput,
): Promise<SavedProvider> {
  const name = normaliseProviderName(input.name)
  const kind = requireProviderKind(input.kind)
  const baseUrl = normaliseBaseUrl(input.baseUrl)
  const modelId = normaliseModelId(input.modelId)
  const editingId = input.id ?? null
  const existing = editingId === null ? null : await deps.providers.findById(editingId)
  if (editingId !== null && existing === null) throw providerNotFound(editingId)
  const id = existing?.id ?? editingId ?? deps.ids.next()
  const now = deps.clock.now()
  const active = await deps.providers.findActive()
  const isActive = existing?.isActive ?? active === null
  const config: ProviderConfig = {
    id,
    name,
    kind,
    baseUrl,
    modelId,
    secretRef: providerSecretRef(id),
    supportsImages:
      input.supportsImages === undefined
        ? (existing?.supportsImages ?? null)
        : input.supportsImages,
    isActive,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const apiKey = input.apiKey?.trim() ?? ''
  if (apiKey !== '') await deps.secrets.store(config.secretRef, apiKey)
  await deps.providers.upsert(config)
  if (isActive) {
    const stored = await deps.settings.read()
    if (stored?.activeProviderId !== config.id) {
      await saveAppSettings({ settings: deps.settings }, { activeProviderId: config.id })
    }
  }
  return {
    config,
    hasCredential: (await readProviderCredential(deps, config)) !== null,
  }
}
