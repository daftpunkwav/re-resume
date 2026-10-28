/**
 * @file ProviderConfigRepository
 * @description Persistence port for the configured model services.
 */

import type { ProviderConfig } from '../ProviderConfig'

export interface ProviderConfigRepository {
  listAll(): Promise<readonly ProviderConfig[]>
  findById(id: string): Promise<ProviderConfig | null>
  findActive(): Promise<ProviderConfig | null>
  /** Inserts a new row, or replaces the row with the same id. */
  upsert(config: ProviderConfig): Promise<void>
  delete(id: string): Promise<void>
  /** Marks one row active and clears the claim on every other row. */
  setActive(id: string | null): Promise<void>
}
