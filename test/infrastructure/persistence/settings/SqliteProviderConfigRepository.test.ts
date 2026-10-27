/**
 * @file SqliteProviderConfigRepository.test
 * @description Row mapping and the active-row contract of the provider table:
 * one active row at a time, upsert by id, and a row whose columns violate the
 * contract reported instead of skipped.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { providerSecretRef } from '../../../../src/domain/settings/ProviderConfig'
import type { ProviderConfig } from '../../../../src/domain/settings/ProviderConfig'
import { SqliteProviderConfigRepository } from '../../../../src/infrastructure/persistence/settings/SqliteProviderConfigRepository'
import type {
  SqlDatabase,
  SqlQueryResult,
  SqlValue,
} from '../../../../src/infrastructure/persistence/sqlite'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'

const TIMESTAMP = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

type Row = Record<string, SqlValue>

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: '本地模型',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'example-model',
    secretRef: providerSecretRef('provider-1'),
    supportsImages: null,
    isActive: false,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  }
}

/**
 * The provider table in a Map, with the statements the repository issues.
 * A statement it does not know fails the test rather than being ignored, so a
 * repository change cannot silently stop being exercised.
 */
class FakeProviderDatabase implements SqlDatabase {
  readonly rows = new Map<string, Row>()

  async execute(query: string, bindValues: readonly SqlValue[] = []): Promise<SqlQueryResult> {
    if (query.startsWith('INSERT INTO provider_config')) {
      const [id, name, kind, baseUrl, modelId, secretRef, supportsImages, isActive, createdAt, updatedAt] =
        bindValues
      this.rows.set(String(id), {
        id: id ?? null,
        name: name ?? null,
        kind: kind ?? null,
        base_url: baseUrl ?? null,
        model_id: modelId ?? null,
        secret_ref: secretRef ?? null,
        supports_images: supportsImages ?? null,
        is_active: isActive ?? null,
        created_at: createdAt ?? null,
        updated_at: updatedAt ?? null,
      })
      return { rowsAffected: 1 }
    }
    if (query === 'UPDATE provider_config SET is_active = 0 WHERE is_active = 1') {
      let affected = 0
      for (const row of this.rows.values()) {
        if (row.is_active === 1) {
          row.is_active = 0
          affected += 1
        }
      }
      return { rowsAffected: affected }
    }
    if (query.startsWith('UPDATE provider_config SET is_active = 1 WHERE id = $1')) {
      const row = this.rows.get(String(bindValues[0]))
      if (row === undefined) return { rowsAffected: 0 }
      row.is_active = 1
      return { rowsAffected: 1 }
    }
    if (query.startsWith('DELETE FROM provider_config WHERE id = $1')) {
      return { rowsAffected: this.rows.delete(String(bindValues[0])) ? 1 : 0 }
    }
    throw new Error(`FakeProviderDatabase cannot execute: ${query}`)
  }

  async select<T>(query: string, bindValues: readonly SqlValue[] = []): Promise<readonly T[]> {
    if (!query.includes('FROM provider_config')) {
      throw new Error(`FakeProviderDatabase cannot select: ${query}`)
    }
    let rows = [...this.rows.values()]
    if (query.includes('WHERE id = $1')) {
      rows = rows.filter((row) => row.id === bindValues[0])
    } else if (query.includes('WHERE is_active = 1')) {
      rows = rows.filter((row) => row.is_active === 1)
    }
    return [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id))) as T[]
  }

  async transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    return work(this)
  }
}

describe('SqliteProviderConfigRepository', () => {
  let database: FakeProviderDatabase
  let repository: SqliteProviderConfigRepository

  beforeEach(() => {
    database = new FakeProviderDatabase()
    repository = new SqliteProviderConfigRepository(database)
  })

  it('round-trips a provider it upserted', async () => {
    const config = provider()
    await repository.upsert(config)

    await expect(repository.findById(config.id)).resolves.toEqual(config)
    await expect(repository.listAll()).resolves.toEqual([config])
  })

  it('replaces the row with the same id instead of adding a second one', async () => {
    await repository.upsert(provider())
    await repository.upsert(provider({ name: '重命名后的服务', modelId: 'other-model' }))

    const configs = await repository.listAll()
    expect(configs).toHaveLength(1)
    expect(configs[0]?.name).toBe('重命名后的服务')
    expect(configs[0]?.modelId).toBe('other-model')
  })

  it('keeps exactly one active provider', async () => {
    await repository.upsert(provider({ id: 'provider-1', isActive: true }))
    await repository.upsert(provider({ id: 'provider-2', secretRef: providerSecretRef('provider-2') }))

    await repository.setActive('provider-2')

    await expect(repository.findActive()).resolves.toMatchObject({ id: 'provider-2' })
    expect((await repository.listAll()).filter((config) => config.isActive)).toHaveLength(1)
  })

  it('clears the active claim', async () => {
    await repository.upsert(provider({ isActive: true }))

    await repository.setActive(null)

    await expect(repository.findActive()).resolves.toBeNull()
  })

  it('deletes a row', async () => {
    await repository.upsert(provider())

    await repository.delete('provider-1')

    await expect(repository.findById('provider-1')).resolves.toBeNull()
  })

  it('reports a row whose kind this build does not know', async () => {
    await repository.upsert(provider())
    const row = database.rows.get('provider-1')
    if (row === undefined) throw new Error('the row should exist')
    row.kind = 'unknown-kind'

    await expect(repository.listAll()).rejects.toMatchObject({
      name: 'RowMappingError',
      column: 'provider_config.kind',
    })
  })

  it('reports a timestamp that is not a date', async () => {
    await repository.upsert(provider())
    const row = database.rows.get('provider-1')
    if (row === undefined) throw new Error('the row should exist')
    row.created_at = 'not-a-date'

    await expect(repository.listAll()).rejects.toBeInstanceOf(Error)
    await expect(repository.listAll()).rejects.toMatchObject({ name: 'RowMappingError' })
  })
})
