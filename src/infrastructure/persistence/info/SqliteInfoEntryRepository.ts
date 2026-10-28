/**
 * @file SqliteInfoEntryRepository
 * @description SQLite implementation of the information entry port. Every
 * mutation writes the entry and its change record inside one transaction, so a
 * stored entry can never be missing from the log that makes it reversible.
 *
 * Constraints:
 * - Reads rebuild the domain value through the row mapper; a row that violates
 *   the column contract raises `RowMappingError`.
 * - The entry is mapped together with its custom module definition, because the
 *   definition declares which field keys a custom entry may carry.
 * - The change insert is an upsert on the identifier: that is the undo path's
 *   way of stamping `undone_at` in the same transaction as the inverse write.
 */

import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { InfoEntryRepository } from '../../../domain/info/ports/InfoEntryRepository'
import type { CustomModuleRepository } from '../../../domain/info/ports/CustomModuleRepository'
import type { InfoModuleKind } from '../../../domain/info/InfoModuleKind'
import type { CustomModuleId, InfoEntryId } from '../../../domain/shared/branded-id'
import { asCustomModuleId } from '../../../domain/shared/branded-id'
import type { ChangeRecord } from '../../../domain/changes/ChangeRecord'
import type { SqlDatabase } from '../sqlite'
import {
  INFO_ENTRY_COLUMNS,
  infoEntryRowValues,
  mapInfoEntryRow,
} from './mappers/InfoEntryRowMapper'
import { insertOrStampChangeRecord } from './mappers/ChangeRecordRowMapper'
import type { Row } from './mappers/rowContract'
import { optionalString } from './mappers/rowContract'
import { rewriteEntrySortOrder } from './orderedRows'

/** Ordering shared by both list queries, so entries of one module are contiguous and ordered. */
const LIST_ORDER = "ORDER BY module_kind, IFNULL(custom_module_id, ''), sort_order, id"

export class SqliteInfoEntryRepository implements InfoEntryRepository {
  readonly #database: SqlDatabase
  readonly #customModules: CustomModuleRepository

  constructor(database: SqlDatabase, customModules: CustomModuleRepository) {
    this.#database = database
    this.#customModules = customModules
  }

  async findById(id: InfoEntryId): Promise<InfoEntry | null> {
    const rows = await this.#database.select<Row>(
      `SELECT ${INFO_ENTRY_COLUMNS} FROM info_entry WHERE id = $1`,
      [id],
    )
    const row = rows[0]
    if (row === undefined) return null
    return mapInfoEntryRow(row, await this.#definitionForRow(row))
  }

  async listAll(): Promise<readonly InfoEntry[]> {
    const definitions = await this.#definitionsByModuleId()
    const rows = await this.#database.select<Row>(
      `SELECT ${INFO_ENTRY_COLUMNS} FROM info_entry ${LIST_ORDER}`,
    )
    return rows.map((row) => mapInfoEntryRow(row, definitionForRow(row, definitions)))
  }

  async listByModule(
    moduleKind: InfoModuleKind,
    customModuleId: CustomModuleId | null,
  ): Promise<readonly InfoEntry[]> {
    const rows = await this.#database.select<Row>(
      `SELECT ${INFO_ENTRY_COLUMNS} FROM info_entry ` +
        "WHERE module_kind = $1 AND IFNULL(custom_module_id, '') = $2 ORDER BY sort_order, id",
      [moduleKind, customModuleId ?? ''],
    )
    const definition =
      moduleKind === 'custom' && customModuleId !== null
        ? await this.#customModules.findById(customModuleId)
        : null
    return rows.map((row) => mapInfoEntryRow(row, definition))
  }

  async insert(entry: InfoEntry, change: ChangeRecord): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO info_entry (${INFO_ENTRY_COLUMNS}) ` +
          'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        infoEntryRowValues(entry),
      )
      await insertOrStampChangeRecord(tx, change)
    })
  }

  async update(entry: InfoEntry, change: ChangeRecord): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const result = await tx.execute(
        'UPDATE info_entry SET module_kind = $2, custom_module_id = $3, title = $4, ' +
          'fields_json = $5, sort_order = $6, origin = $7, source_run_id = $8, ' +
          'created_at = $9, updated_at = $10 WHERE id = $1',
        infoEntryRowValues(entry),
      )
      if (result.rowsAffected !== 1) {
        throw new Error(`The info entry "${entry.id}" disappeared during the update.`)
      }
      await insertOrStampChangeRecord(tx, change)
    })
  }

  async delete(id: InfoEntryId, change: ChangeRecord): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const result = await tx.execute('DELETE FROM info_entry WHERE id = $1', [id])
      if (result.rowsAffected !== 1) {
        throw new Error(`The info entry "${id}" disappeared during the delete.`)
      }
      await insertOrStampChangeRecord(tx, change)
    })
  }

  async reorder(
    moduleKind: InfoModuleKind,
    customModuleId: CustomModuleId | null,
    orderedIds: readonly InfoEntryId[],
    change: ChangeRecord,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await rewriteEntrySortOrder(tx, moduleKind, customModuleId, orderedIds)
      await insertOrStampChangeRecord(tx, change)
    })
  }

  async countByModule(
    moduleKind: InfoModuleKind,
    customModuleId: CustomModuleId | null,
  ): Promise<number> {
    const rows = await this.#database.select<{ readonly count: unknown }>(
      'SELECT COUNT(*) AS count FROM info_entry ' +
        "WHERE module_kind = $1 AND IFNULL(custom_module_id, '') = $2",
      [moduleKind, customModuleId ?? ''],
    )
    const count = rows[0]?.count
    if (typeof count !== 'number') {
      throw new Error('The database did not report a count for the module.')
    }
    return count
  }

  async #definitionsByModuleId(): Promise<ReadonlyMap<string, CustomModuleDefinition>> {
    const definitions = await this.#customModules.listAll()
    return new Map(definitions.map((definition) => [definition.id, definition]))
  }

  async #definitionForRow(row: Row): Promise<CustomModuleDefinition | null> {
    const moduleId = optionalString(row, 'custom_module_id')
    if (moduleId === null) return null
    return this.#customModules.findById(asCustomModuleId(moduleId))
  }
}

function definitionForRow(
  row: Row,
  definitions: ReadonlyMap<string, CustomModuleDefinition>,
): CustomModuleDefinition | null {
  const moduleId = optionalString(row, 'custom_module_id')
  if (moduleId === null) return null
  return definitions.get(moduleId) ?? null
}
