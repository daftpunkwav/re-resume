/**
 * @file inMemoryRepositories
 * @description Memory-backed port implementations for the browser preview. The
 * interface can be opened, screenshot and tested without the native container;
 * the preview assembly receives the same service types the application does.
 *
 * Constraints:
 * - Preview assembly only. Nothing here may reach the disk, the network or the
 *   native container.
 * - A memory repository keeps values by reference, exactly as a row would keep
 *   columns: callers treat what they read as immutable.
 */

import { DEFAULT_APP_SETTINGS } from '../../domain/settings/AppSettings'
import type { AppSettings } from '../../domain/settings/AppSettings'
import type { AppSettingsRepository } from '../../domain/settings/ports/AppSettingsRepository'
import type { ProviderConfig } from '../../domain/settings/ProviderConfig'
import type { ProviderConfigRepository } from '../../domain/settings/ports/ProviderConfigRepository'
import type { SecretStore } from '../../domain/generation/ports/SecretStore'

export class InMemoryAppSettingsRepository implements AppSettingsRepository {
  #settings: AppSettings | null

  constructor(initial: AppSettings | null = DEFAULT_APP_SETTINGS) {
    this.#settings = initial
  }

  async read(): Promise<AppSettings | null> {
    return this.#settings
  }

  async write(settings: AppSettings): Promise<void> {
    this.#settings = settings
  }
}

export class InMemoryProviderConfigRepository implements ProviderConfigRepository {
  readonly #rows: Map<string, ProviderConfig>

  constructor(initial: readonly ProviderConfig[] = []) {
    this.#rows = new Map(initial.map((config) => [config.id, config]))
  }

  async listAll(): Promise<readonly ProviderConfig[]> {
    return [...this.#rows.values()]
  }

  async findById(id: string): Promise<ProviderConfig | null> {
    return this.#rows.get(id) ?? null
  }

  async findActive(): Promise<ProviderConfig | null> {
    return [...this.#rows.values()].find((config) => config.isActive) ?? null
  }

  async upsert(config: ProviderConfig): Promise<void> {
    this.#rows.set(config.id, config)
  }

  async delete(id: string): Promise<void> {
    this.#rows.delete(id)
  }

  async setActive(id: string | null): Promise<void> {
    for (const [key, config] of this.#rows) {
      this.#rows.set(key, { ...config, isActive: id !== null && key === id })
    }
  }
}

/** Credentials held for the lifetime of the preview session. */
export class InMemorySecretStore implements SecretStore {
  readonly #secrets: Map<string, string>

  constructor(initial: readonly (readonly [string, string])[] = []) {
    this.#secrets = new Map(initial)
  }

  async store(ref: string, secret: string): Promise<void> {
    this.#secrets.set(ref, secret)
  }

  async load(ref: string): Promise<string | null> {
    return this.#secrets.get(ref) ?? null
  }

  async remove(ref: string): Promise<void> {
    this.#secrets.delete(ref)
  }
}
