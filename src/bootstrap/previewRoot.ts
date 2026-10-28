/**
 * @file previewRoot
 * @description The composition root used by the browser preview. It answers
 * the same contract as the native root, backed by memory instead of SQLite, so
 * the interface needs no preview branch of its own.
 *
 * Constraints:
 * - Only loaded when the window is served in development with `?preview`; the
 *   production bundle does not contain this module.
 * - Areas added later extend this file by one wiring import and one spread;
 *   the root's contract stays in `capabilities.ts`.
 */

import type { CompositionRoot } from './capabilities'
import { describeAppInfo } from './buildInfo'
import { createAppSettingsService } from './wiring/appSettings'
import { createInfoService } from './wiring/info'
import {
  InMemoryAppSettingsRepository,
  InMemorySecretStore,
} from '../infrastructure/preview/inMemoryRepositories'
import {
  InMemoryChangeLogRepository,
  InMemoryCustomModuleRepository,
  InMemoryEntryReferenceQuery,
  InMemoryInfoEntryRepository,
} from '../infrastructure/preview/inMemoryInfoRepositories'
import {
  FakeClock,
  SequentialIdGenerator,
} from '../infrastructure/preview/deterministicEnvironment'
import { PREVIEW_SETTINGS } from '../infrastructure/preview/fixtures'
import {
  PREVIEW_INFO_CUSTOM_MODULES,
  PREVIEW_INFO_ENTRIES,
} from '../infrastructure/preview/fixtures.info'

/**
 * The preview library: fixtures seeded into memory repositories, with a
 * deterministic clock and identifier source so a session is repeatable. The
 * preview holds no resume, so no section references a library value.
 */
function createPreviewInfoService(): CompositionRoot['info'] {
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  entries.seed(PREVIEW_INFO_ENTRIES)
  customModules.seed(PREVIEW_INFO_CUSTOM_MODULES)
  return createInfoService({
    entries,
    customModules,
    references: new InMemoryEntryReferenceQuery(),
    clock: new FakeClock(),
    ids: new SequentialIdGenerator('preview-info'),
  })
}

export function createPreviewRoot(): CompositionRoot {
  const settingsRepository = new InMemoryAppSettingsRepository(PREVIEW_SETTINGS)
  return {
    appInfo: describeAppInfo({ runtime: 'browser', databaseFile: null }),
    settings: createAppSettingsService({ repository: settingsRepository }),
    info: createPreviewInfoService(),
    secrets: new InMemorySecretStore(),
    shutdown: async (): Promise<void> => undefined,
  }
}
