/**
 * @file SqliteCustomModuleRepository
 * @description SQLite implementation of the custom module port. A definition is
 * written together with the entries a field removal touches and with the change
 * record that makes the write reversible, in one transaction.
 *
 * Constraints:
 * - Reads rebuild the domain value through the row mapper; a stored definition
 *   that violates the module contract raises `RowMappingError`.
 * - `delete` refuses a caller snapshot that no longer matches the entries the
 *   module owns: the change record would otherwise claim a cascade it did not
 *   perform.
 * - Clearing a removed field rewrites the stored field record of each affected
 *   entry; an entry that disappeared in the meantime aborts the transaction.
 */

import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type {
  CustomFieldValueChange,
  CustomModuleRepository,
} from '../../../domain/info/ports/CustomModuleRepository'
import type { InfoEntry } from '../../../domain/info/InfoEntry'
import type { ChangeRecord } from '../../../domain/changes/ChangeRecord'
import type { CustomModuleId } from '../../../domain/shared/branded-id'
import { readJsonRecordEnvelope, writeJsonEnvelope } from '../JsonEnvelope'
import type { SqlDatabase } from '../sqlite'
import {
  CUSTOM_MODULE_COLUMNS,
  customModuleFieldsEnvelope,
  customModuleRowValues,
  mapCustomModuleRow,
} from './mappers/CustomModuleRowMapper'
import { insertOrStampChangeRecord } from './mappers/ChangeRecordRowMapper'
import {
  INFO_ENTRY_COLUMNS,
  infoEntryRowValues,
} from './mappers/InfoEntryRowMapper'
import type { Row } from './mappers/rowContract'
import { rewriteModuleSortOrder } from './orderedRows'

const MODULE_ORDER = 'ORDER BY sort_order, id'

export class SqliteCustomModuleRepository implements CustomModuleRepository {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async findById(id: CustomModuleId): Promise<CustomModuleDefinition | null> {
    const rows = await this.#database.select<Row>(
      `SELECT ${CUSTOM_MODULE_COLUMNS} FROM custom_module WHERE id = $1`,
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : mapCustomModuleRow(row)
  }

  async listAll(): Promise<readonly CustomModuleDefinition[]> {
    const rows = await this.#database.select<Row>(
      `SELECT ${CUSTOM_MODULE_COLUMNS} FROM custom_module ${MODULE_ORDER}`,
    )
    return rows.map(mapCustomModuleRow)
  }

  async insert(
    module: CustomModuleDefinition,
    change: ChangeRecord,
    restoredEntries: readonly InfoEntry[] = [],
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO custom_module (${CUSTOM_MODULE_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`,
        customModuleRowValues(module),
      )
      for (const entry of restoredEntries) {
        if (entry.customModuleId !== module.id) {
          throw new Error(
            `Cannot restore entry "${entry.id}" into module "${module.id}": ` +
              'the entry names a different module.',
          )
        }
        await tx.execute(
          `INSERT INTO info_entry (${INFO_ENTRY_COLUMNS}) ` +
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
          infoEntryRowValues(entry),
        )
      }
      await insertOrStampChangeRecord(tx, change)
    })
  }

  async update(
    module: CustomModuleDefinition,
    fieldValueChanges: readonly CustomFieldValueChange[],
    change: ChangeRecord,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const result = await tx.execute(
        'UPDATE custom_module SET name = $2, fields_json = $3, sort_order = $4, ' +
          'updated_at = $5 WHERE id = $1',
        [
          module.id,
          module.name,
          customModuleFieldsEnvelope(module),
          module.sortOrder,
          module.updatedAt,
        ],
      )
      if (result.rowsAffected !== 1) {
        throw new Error(`The custom module "${module.id}" disappeared during the update.`)
      }
      await applyFieldValueChanges(tx, fieldValueChanges, module.updatedAt)
      await insertOrStampChangeRecord(tx, change)
    })
  }

  async delete(
    id: CustomModuleId,
    entries: readonly InfoEntry[],
    change: ChangeRecord,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const stored = await tx.select<{ readonly count: unknown }>(
        'SELECT COUNT(*) AS count FROM info_entry WHERE custom_module_id = $1',
        [id],
      )
      const storedCount = stored[0]?.count
      if (typeof storedCount !== 'number') {
        throw new Error('The database did not report the entry count of the custom module.')
      }
      if (storedCount !== entries.length) {
        throw new Error(
          `The custom module "${id}" owns ${storedCount.toString()} entries, but the caller ` +
            `reported ${entries.length.toString()}: the change record would not be a faithful inverse.`,
        )
      }
      await tx.execute('DELETE FROM info_entry WHERE custom_module_id = $1', [id])
      const result = await tx.execute('DELETE FROM custom_module WHERE id = $1', [id])
      if (result.rowsAffected !== 1) {
        throw new Error(`The custom module "${id}" disappeared during the delete.`)
      }
      await insertOrStampChangeRecord(tx, change)
    })
  }

  async reorder(orderedIds: readonly CustomModuleId[], change: ChangeRecord): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await rewriteModuleSortOrder(tx, orderedIds)
      await insertOrStampChangeRecord(tx, change)
    })
  }
}

/**
 * Applies the field value changes to the affected entries, one pass per entry.
 * The stored field record is rewritten rather than patched in SQL, so a row that
 * is not a JSON envelope fails loudly here instead of being silently replaced.
 *
 * A change without a value removes the key (a field removal); a change with one
 * writes it back (the inverse of a removal).
 */
async function applyFieldValueChanges(
  database: SqlDatabase,
  fieldValueChanges: readonly CustomFieldValueChange[],
  updatedAt: string,
): Promise<void> {
  const changesByEntry = new Map<string, CustomFieldValueChange[]>()
  for (const fieldChange of fieldValueChanges) {
    const changes = changesByEntry.get(fieldChange.entryId) ?? []
    changes.push(fieldChange)
    changesByEntry.set(fieldChange.entryId, changes)
  }
  for (const [entryId, changes] of changesByEntry) {
    const rows = await database.select<Row>(
      'SELECT fields_json FROM info_entry WHERE id = $1',
      [entryId],
    )
    const row = rows[0]
    if (row === undefined) {
      throw new Error(
        `Cannot apply a field change: the info entry "${entryId}" no longer exists.`,
      )
    }
    const fields = readJsonRecordEnvelope(row.fields_json, 'info_entry.fields_json')
    for (const change of changes) {
      if (change.restoredValue === undefined) {
        delete fields[change.fieldKey]
      } else {
        fields[change.fieldKey] = change.restoredValue
      }
    }
    const result = await database.execute(
      'UPDATE info_entry SET fields_json = $1, updated_at = $2 WHERE id = $3',
      [writeJsonEnvelope(fields), updatedAt, entryId],
    )
    if (result.rowsAffected !== 1) {
      throw new Error(`Cannot apply a field change: the info entry "${entryId}" was not updated.`)
    }
  }
}
