/**
 * @file ProviderConfig
 * @description One model service the assistant can talk through. The row holds
 * the endpoint and the model name; the credential itself lives in the system
 * secure store, referenced by `secretRef`.
 *
 * Constraints:
 * - This type is persisted as columns, not as an envelope: the provider list is
 *   queried individually (active provider, by id), so each field gets a column.
 * - The secret reference is not a secret; it names the record inside the
 *   secure store and never contains the key material.
 */

import type { DateTime } from '../shared/DateTime'

export const PROVIDER_KINDS = ['openai-compatible', 'anthropic'] as const

export type ProviderKind = (typeof PROVIDER_KINDS)[number]

export interface ProviderConfig {
  readonly id: string
  readonly name: string
  readonly kind: ProviderKind
  readonly baseUrl: string
  readonly modelId: string
  /** Key of the credential in the secure store, `provider:<id>`. */
  readonly secretRef: string
  /** null = infer from the kind and the model name. */
  readonly supportsImages: boolean | null
  readonly isActive: boolean
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && (PROVIDER_KINDS as readonly string[]).includes(value)
}

/** The secure-store reference this provider's credential is stored under. */
export function providerSecretRef(providerId: string): string {
  return `provider:${providerId}`
}
