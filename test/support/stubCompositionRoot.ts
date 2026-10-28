/**
 * @file stubCompositionRoot
 * @description A composition root for tests that need the provider but not the
 * native container. The same contract as the preview root, with the version and
 * service functions easy to override.
 */

import type { CompositionRoot } from '../../src/bootstrap/capabilities'
import { createInfoService } from '../../src/bootstrap/wiring/info'
import { DEFAULT_APP_SETTINGS } from '../../src/domain/settings/AppSettings'
import type { AppSettings } from '../../src/domain/settings/AppSettings'
import { InMemorySecretStore } from '../../src/infrastructure/preview/inMemoryRepositories'
import {
  InMemoryChangeLogRepository,
  InMemoryCustomModuleRepository,
  InMemoryEntryReferenceQuery,
  InMemoryInfoEntryRepository,
} from '../../src/infrastructure/preview/inMemoryInfoRepositories'
import { FixedClock, SequentialIdGenerator } from './fakeEnvironment'

export function stubCompositionRoot(overrides: Partial<CompositionRoot> = {}): CompositionRoot {
  const settings: AppSettings = DEFAULT_APP_SETTINGS
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
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
    info: createInfoService({
      entries,
      customModules,
      references: new InMemoryEntryReferenceQuery(),
      clock: new FixedClock(),
      ids: new SequentialIdGenerator('stub'),
    }),
    secrets: new InMemorySecretStore(),
    shutdown: async () => undefined,
    ...overrides,
  }
}
