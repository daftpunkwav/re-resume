/**
 * @file SqliteProviderConfigRepository
 * @description Persistence for the configured model services. One row per
 * provider; the credential itself stays in the secure store, and this table
 * only names it.
 *
 * Constraints:
 * - The partial unique index on `is_active` enforces at most one active row,
 *   so setActive runs in one transaction: clearing the old row and claiming the
 *   new one must not be observable as two active rows.
 * - A row whose kind, flag or timestamp cannot be reconstructed is reported as
 *   a mapping error rather than skipped, because a skipped provider silently
 *   changes which model the assistant would use.
 */

import { isProviderKind } from '../../../domain/settings/ProviderConfig'
import type { ProviderConfig } from '../../../domain/settings/ProviderConfig'
import type { ProviderConfigRepository } from '../../../domain/settings/ports/ProviderConfigRepository'
import { parseDateTime } from '../../../domain/shared/DateTime'
import type { DateTime } from '../../../domain/shared/DateTime'
import type { SqlDatabase } from '../sqlite'
import { RowMappingError } from '../JsonEnvelope'

const PROVIDER_COLUMNS =
  'id, name, kind, base_url, model_id, secret_ref, supports_images, is_active, created_at, updated_at'

interface ProviderRow {
  readonly id: unknown
  readonly name: unknown
  readonly kind: unknown
  readonly base_url: unknown
  readonly model_id: unknown
  readonly secret_ref: unknown
  readonly supports_images: unknown
  readonly is_active: unknown
  readonly created_at: unknown
  readonly updated_at: unknown
}

function requiredText(row: ProviderRow, column: keyof ProviderRow): string {
  const value = row[column]
  if (typeof value !== 'string' || value.length === 0) {
    throw new RowMappingError(`provider_config.${column}`, 'expected a non-empty string', value)
  }
  return value
}

function requiredTimestamp(row: ProviderRow, column: keyof ProviderRow): DateTime {
  const value = row[column]
  if (typeof value !== 'string') {
    throw new RowMappingError(`provider_config.${column}`, 'expected a timestamp string', value)
  }
  const parsed = parseDateTime(value)
  if (parsed === null) {
    throw new RowMappingError(`provider_config.${column}`, 'timestamp is not a valid date', value)
  }
  return parsed
}

function requiredBooleanFlag(row: ProviderRow, column: keyof ProviderRow): boolean {
  const value = row[column]
  if (value === 1) return true
  if (value === 0) return false
  throw new RowMappingError(`provider_config.${column}`, 'expected the flag 0 or 1', value)
}

function optionalBooleanFlag(row: ProviderRow, column: keyof ProviderRow): boolean | null {
  if (row[column] === null) return null
  return requiredBooleanFlag(row, column)
}

function toProviderConfig(row: ProviderRow): ProviderConfig {
  const kind = row.kind
  if (!isProviderKind(kind)) {
    throw new RowMappingError(
      'provider_config.kind',
      'value is not one of the provider kinds this build knows',
      kind,
    )
  }
  return {
    id: requiredText(row, 'id'),
    name: requiredText(row, 'name'),
    kind,
    baseUrl: requiredText(row, 'base_url'),
    modelId: requiredText(row, 'model_id'),
    secretRef: requiredText(row, 'secret_ref'),
    supportsImages: optionalBooleanFlag(row, 'supports_images'),
    isActive: requiredBooleanFlag(row, 'is_active'),
    createdAt: requiredTimestamp(row, 'created_at'),
    updatedAt: requiredTimestamp(row, 'updated_at'),
  }
}

export class SqliteProviderConfigRepository implements ProviderConfigRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async listAll(): Promise<readonly ProviderConfig[]> {
    return this.#select(`SELECT ${PROVIDER_COLUMNS} FROM provider_config ORDER BY created_at ASC, id ASC`)
  }

  async findById(id: string): Promise<ProviderConfig | null> {
    const rows = await this.#select(
      `SELECT ${PROVIDER_COLUMNS} FROM provider_config WHERE id = $1`,
      [id],
    )
    return rows[0] ?? null
  }

  async findActive(): Promise<ProviderConfig | null> {
    const rows = await this.#select(
      `SELECT ${PROVIDER_COLUMNS} FROM provider_config WHERE is_active = 1`,
    )
    return rows[0] ?? null
  }

  async upsert(config: ProviderConfig): Promise<void> {
    await this.#database.execute(
      `INSERT INTO provider_config (${PROVIDER_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ` +
        'ON CONFLICT (id) DO UPDATE SET name = $2, kind = $3, base_url = $4, model_id = $5, ' +
        'secret_ref = $6, supports_images = $7, is_active = $8, updated_at = $10',
      [
        config.id,
        config.name,
        config.kind,
        config.baseUrl,
        config.modelId,
        config.secretRef,
        config.supportsImages === null ? null : config.supportsImages ? 1 : 0,
        config.isActive ? 1 : 0,
        config.createdAt,
        config.updatedAt,
      ],
    )
  }

  async delete(id: string): Promise<void> {
    await this.#database.execute('DELETE FROM provider_config WHERE id = $1', [id])
  }

  async setActive(id: string | null): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await tx.execute('UPDATE provider_config SET is_active = 0 WHERE is_active = 1')
      if (id === null) return
      await tx.execute('UPDATE provider_config SET is_active = 1 WHERE id = $1', [id])
    })
  }

  async #select(
    query: string,
    bindValues?: readonly (string | number | null)[],
  ): Promise<readonly ProviderConfig[]> {
    const rows = await this.#database.select<ProviderRow>(
      query,
      bindValues === undefined ? undefined : [...bindValues],
    )
    return rows.map(toProviderConfig)
  }
}
