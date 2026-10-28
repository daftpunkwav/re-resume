/**
 * @file SqliteBackupStore
 * @description The SQLite implementation of the backup port: read every table,
 * replace every table in one transaction, clear the data, and find attachment
 * rows nothing refers to.
 *
 * Constraints:
 * - The table list is the domain's backup schema, not a discovery of whatever
 *   SQLite happens to hold: an unknown table would be data the document cannot
 *   describe. `BACKUP_TABLES` order is used for inserts and reversed for
 *   deletes, so foreign keys hold on both sides.
 * - Identifiers in the statements are the closed table/column names of that
 *   schema; values are always bound, never interpolated.
 * - `replaceAll` runs as one transaction: a document is applied completely or
 *   not at all.
 */

import {
  BACKUP_TABLES,
} from '../../../domain/backup/BackupDocument'
import type {
  BackupRow,
  BackupTables,
} from '../../../domain/backup/BackupDocument'
import type {
  BackupStore,
  OrphanAttachment,
} from '../../../domain/backup/ports/BackupStore'
import type { DateTime } from '../../../domain/shared/DateTime'
import type { SqlDatabase, SqlValue } from '../sqlite'

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

export class SqliteBackupStore implements BackupStore {
  readonly #database: SqlDatabase

  constructor(database: SqlDatabase) {
    this.#database = database
  }

  async dumpTables(): Promise<BackupTables> {
    const tables: Record<string, readonly BackupRow[]> = {}
    for (const table of BACKUP_TABLES) {
      const rows = await this.#database.select<Record<string, SqlValue>>(
        `SELECT * FROM ${quote(table)}`,
      )
      tables[table] = rows.map((row) => ({ ...row }))
    }
    return tables
  }

  async replaceAll(tables: BackupTables): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await deleteEverything(tx)
      for (const table of BACKUP_TABLES) {
        const rows = tables[table] ?? []
        if (rows.length === 0) continue
        const columns = Object.keys(rows[0] as BackupRow)
        const placeholders = columns.map((_, index) => `$${(index + 1).toString()}`).join(', ')
        const statement = `INSERT INTO ${quote(table)} (${columns
          .map(quote)
          .join(', ')}) VALUES (${placeholders})`
        for (const row of rows) {
          await tx.execute(
            statement,
            columns.map((column) => row[column] ?? null),
          )
        }
      }
    })
  }

  async clearAll(): Promise<void> {
    await this.#database.transaction(deleteEverything)
  }

  async listOrphanAttachments(createdBefore: DateTime): Promise<readonly OrphanAttachment[]> {
    return this.#database.select<OrphanAttachment>(
      `SELECT a.id AS "id", a.storage_name AS "storageName"
       FROM attachment a
       WHERE a.created_at < $1
         AND NOT EXISTS (SELECT 1 FROM message_attachment m WHERE m.attachment_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM job_posting j WHERE j.image_attachment_ids LIKE '%' || a.id || '%')
         AND NOT EXISTS (SELECT 1 FROM resume_revision r WHERE r.state_json LIKE '%' || a.id || '%')
         AND NOT EXISTS (SELECT 1 FROM resume_snapshot s WHERE s.frozen_state_json LIKE '%' || a.id || '%')`,
      [createdBefore],
    )
  }

  async deleteAttachments(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    await this.#database.transaction(async (tx) => {
      for (const id of ids) {
        await tx.execute('DELETE FROM attachment WHERE id = $1', [id])
      }
    })
  }

  async listAttachmentStorageNames(): Promise<readonly string[]> {
    const rows = await this.#database.select<{ storage_name: string }>(
      'SELECT storage_name FROM attachment',
    )
    return rows.map((row) => row.storage_name)
  }

  async listProviderSecretRefs(): Promise<readonly string[]> {
    const rows = await this.#database.select<{ secret_ref: string }>(
      'SELECT secret_ref FROM provider_config',
    )
    return rows.map((row) => row.secret_ref)
  }
}

/** Deletes every row of every backup table, children before parents. */
async function deleteEverything(tx: SqlDatabase): Promise<void> {
  for (const table of [...BACKUP_TABLES].reverse()) {
    await tx.execute(`DELETE FROM ${quote(table)}`)
  }
}
