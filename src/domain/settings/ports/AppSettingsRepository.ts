/**
 * @file AppSettingsRepository
 * @description Persistence port for the interface preferences. The database
 * row is the truth; the first-paint cache in local storage only mirrors it.
 */

import type { AppSettings } from '../AppSettings'

export interface AppSettingsRepository {
  /** null means nothing has been stored yet, not that defaults apply. */
  read(): Promise<AppSettings | null>
  write(settings: AppSettings): Promise<void>
}
