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
import {
  InMemoryAppSettingsRepository,
  InMemorySecretStore,
} from '../infrastructure/preview/inMemoryRepositories'
import { PREVIEW_SETTINGS } from '../infrastructure/preview/fixtures'

export function createPreviewRoot(): CompositionRoot {
  const settingsRepository = new InMemoryAppSettingsRepository(PREVIEW_SETTINGS)
  return {
    appInfo: describeAppInfo({ runtime: 'browser', databaseFile: null }),
    settings: createAppSettingsService({ repository: settingsRepository }),
    secrets: new InMemorySecretStore(),
    shutdown: async (): Promise<void> => undefined,
  }
}
