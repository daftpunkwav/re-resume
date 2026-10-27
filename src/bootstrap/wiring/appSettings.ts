/**
 * @file appSettings
 * @description Wires the settings use cases to the repository they need. One
 * file per area, so the assembly of one area changes without touching the
 * others.
 */

import { readAppSettings } from '../../application/settings/readAppSettings'
import { saveAppSettings } from '../../application/settings/saveAppSettings'
import type { AppSettings } from '../../domain/settings/AppSettings'
import type { AppSettingsRepository } from '../../domain/settings/ports/AppSettingsRepository'
import type { AppSettingsService } from '../capabilities'

export interface AppSettingsWiring {
  readonly repository: AppSettingsRepository
}

export function createAppSettingsService(wiring: AppSettingsWiring): AppSettingsService {
  return {
    read: () => readAppSettings({ settings: wiring.repository }),
    save: (patch: Partial<AppSettings>) =>
      saveAppSettings({ settings: wiring.repository }, patch),
  }
}
