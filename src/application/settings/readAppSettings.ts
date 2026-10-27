/**
 * @file readAppSettings
 * @description Reads the interface preferences, seeding the row on first use.
 *
 * Responsibilities:
 * - Return the stored preferences, or the defaults when nothing was stored
 * - Insert the defaults so later reads find a row rather than creating it again
 *
 * Constraints:
 * - The repository is the only dependency: the use case owns no ambient state.
 */

import type { AppSettingsRepository } from '../../domain/settings/ports/AppSettingsRepository'
import { DEFAULT_APP_SETTINGS } from '../../domain/settings/AppSettings'
import type { AppSettings } from '../../domain/settings/AppSettings'

export interface ReadAppSettingsDeps {
  readonly settings: AppSettingsRepository
}

export async function readAppSettings(
  deps: ReadAppSettingsDeps,
): Promise<AppSettings> {
  const stored = await deps.settings.read()
  if (stored !== null) return stored
  await deps.settings.write(DEFAULT_APP_SETTINGS)
  return DEFAULT_APP_SETTINGS
}
