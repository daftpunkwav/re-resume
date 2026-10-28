/**
 * @file SqliteAppSettingsRepository
 * @description Reads and writes the single settings row. The row is one JSON
 * envelope so a preference added later does not need a migration; the envelope
 * version guards the shape in the other direction.
 *
 * Constraints:
 * - A stored envelope this build cannot validate is reported as a mapping
 *   error, not replaced by defaults: replacing it would discard a choice the
 *   user made and make the loss invisible.
 * - The `id` column is pinned to 'default' by a CHECK constraint, so the table
 *   cannot grow a second row through this repository.
 */

import { isAppSettings } from '../../../domain/settings/AppSettings'
import type { AppSettings } from '../../../domain/settings/AppSettings'
import type { AppSettingsRepository } from '../../../domain/settings/ports/AppSettingsRepository'
import type { Clock } from '../../../domain/shared/Clock'
import type { SqlDatabase } from '../sqlite'
import { readJsonEnvelope, RowMappingError, writeJsonEnvelope } from '../JsonEnvelope'

/** The primary key every settings row carries; the column CHECK asserts it. */
const SETTINGS_ROW_ID = 'default'

const SETTINGS_COLUMNS = 'settings_json'

interface SettingsRow {
  readonly settings_json: unknown
}

export class SqliteAppSettingsRepository implements AppSettingsRepository {
  readonly #database: SqlDatabase
  readonly #clock: Clock

  constructor(database: SqlDatabase, clock: Clock) {
    this.#database = database
    this.#clock = clock
  }

  async read(): Promise<AppSettings | null> {
    const rows = await this.#database.select<SettingsRow>(
      `SELECT ${SETTINGS_COLUMNS} FROM app_settings WHERE id = $1`,
      [SETTINGS_ROW_ID],
    )
    const row = rows[0]
    if (row === undefined) return null
    const payload = readJsonEnvelope(row.settings_json, 'app_settings.settings_json')
    if (!isAppSettings(payload)) {
      throw new RowMappingError(
        'app_settings.settings_json',
        'envelope payload is not a complete settings object',
        row.settings_json,
      )
    }
    return payload
  }

  async write(settings: AppSettings): Promise<void> {
    await this.#database.execute(
      `INSERT INTO app_settings (id, ${SETTINGS_COLUMNS}, updated_at) VALUES ($1, $2, $3) ` +
        `ON CONFLICT (id) DO UPDATE SET ${SETTINGS_COLUMNS} = $2, updated_at = $3`,
      [SETTINGS_ROW_ID, writeJsonEnvelope(settings), this.#clock.now()],
    )
  }
}
