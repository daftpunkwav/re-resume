/**
 * @file SqliteAppSettingsRepository.test
 * @description Row mapping around the single settings row: a missing row reads
 * as null, a written row round-trips, and a stored envelope this build cannot
 * validate is reported rather than replaced by defaults.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import { SqliteAppSettingsRepository } from '../../../../src/infrastructure/persistence/settings/SqliteAppSettingsRepository'
import type {
  SqlDatabase,
  SqlQueryResult,
  SqlValue,
} from '../../../../src/infrastructure/persistence/sqlite'
import {
  RowMappingError,
  writeJsonEnvelope,
} from '../../../../src/infrastructure/persistence/JsonEnvelope'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import { FixedClock } from '../../../../test/support/fakeEnvironment'

const CLOCK_INSTANT = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime

/** Just enough of a database for one settings row. */
class FakeSettingsDatabase implements SqlDatabase {
  readonly rows: { id: SqlValue; settings_json: SqlValue; updated_at: SqlValue }[] = []
  readonly statements: string[] = []

  async execute(
    query: string,
    bindValues: readonly SqlValue[] = [],
  ): Promise<SqlQueryResult> {
    this.statements.push(query)
    if (!query.includes('INSERT INTO app_settings')) {
      throw new Error(`FakeSettingsDatabase cannot execute: ${query}`)
    }
    const [id, settingsJson, updatedAt] = bindValues
    const existing = this.rows[0]
    if (existing === undefined) {
      this.rows.push({ id: id ?? null, settings_json: settingsJson ?? null, updated_at: updatedAt ?? null })
      return { rowsAffected: 1 }
    }
    existing.settings_json = settingsJson ?? null
    existing.updated_at = updatedAt ?? null
    return { rowsAffected: 1 }
  }

  async select<T>(query: string, bindValues: readonly SqlValue[] = []): Promise<readonly T[]> {
    this.statements.push(query)
    if (!query.includes('FROM app_settings')) {
      throw new Error(`FakeSettingsDatabase cannot select: ${query}`)
    }
    const id = bindValues[0]
    return this.rows.filter((row) => row.id === id) as unknown as readonly T[]
  }

  async transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    return work(this)
  }
}

function newRepository(): {
  database: FakeSettingsDatabase
  repository: SqliteAppSettingsRepository
} {
  const database = new FakeSettingsDatabase()
  const clock = new FixedClock(CLOCK_INSTANT)
  return { database, repository: new SqliteAppSettingsRepository(database, clock) }
}

describe('SqliteAppSettingsRepository', () => {
  it('reads null before anything has been stored', async () => {
    const { repository } = newRepository()
    await expect(repository.read()).resolves.toBeNull()
  })

  it('round-trips the value it wrote', async () => {
    const { repository } = newRepository()
    const settings = {
      ...DEFAULT_APP_SETTINGS,
      uiScale: 1.3,
      panels: { right: 'both' as const, rightWidth: 460, collapsed: false },
    }

    await repository.write(settings)

    await expect(repository.read()).resolves.toEqual(settings)
  })

  it('reports a stored envelope from another format version', async () => {
    const { database, repository } = newRepository()
    database.rows.push({
      id: 'default',
      settings_json: JSON.stringify({ v: 2, data: DEFAULT_APP_SETTINGS }),
      updated_at: '2026-03-01T00:00:00.000Z',
    })

    await expect(repository.read()).rejects.toBeInstanceOf(RowMappingError)
  })

  it('reports a stored payload that is not a complete settings value', async () => {
    const { database, repository } = newRepository()
    database.rows.push({
      id: 'default',
      settings_json: writeJsonEnvelope({ themeId: 'apple' }),
      updated_at: '2026-03-01T00:00:00.000Z',
    })

    await expect(repository.read()).rejects.toMatchObject({
      name: 'RowMappingError',
      column: 'app_settings.settings_json',
    })
  })
})
