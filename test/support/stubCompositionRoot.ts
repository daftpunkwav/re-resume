/**
 * @file stubCompositionRoot
 * @description A composition root for tests that need the provider but not the
 * native container. The same contract as the preview root, with the version and
 * service functions easy to override.
 */

import type { CompositionRoot } from '../../src/bootstrap/capabilities'
import { DEFAULT_APP_SETTINGS } from '../../src/domain/settings/AppSettings'
import type { AppSettings } from '../../src/domain/settings/AppSettings'
import { InMemorySecretStore } from '../../src/infrastructure/preview/inMemoryRepositories'

export function stubCompositionRoot(overrides: Partial<CompositionRoot> = {}): CompositionRoot {
  const settings: AppSettings = DEFAULT_APP_SETTINGS
  return {
    appInfo: {
      version: '0.0.0-test',
      buildMode: 'test',
      runtime: 'browser',
      license: 'MIT',
      databaseFile: null,
    },
    settings: {
      read: async () => settings,
      save: async (patch) => ({ ...settings, ...patch }),
    },
    secrets: new InMemorySecretStore(),
    shutdown: async () => undefined,
    ...overrides,
  }
}
