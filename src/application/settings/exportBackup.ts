/**
 * @file exportBackup
 * @description Builds the one-file backup document: every table row, plus the
 * bytes of every attachment the rows name.
 *
 * Responsibilities:
 * - Read the tables through the backup port and the bytes through the file store
 * - Encode bytes as base64 so the whole backup is one JSON file
 * - Validate the result before returning it, so an export that cannot be
 *   imported again is a failure here rather than a surprise at restore time
 *
 * Constraints:
 * - An attachment row whose file is missing makes the export fail: a backup
 *   that silently drops bytes is worse than no backup, because the user would
 *   believe the data was preserved.
 */

import type { BackupDocument } from '../../domain/backup/BackupDocument'
import {
  BACKUP_APP_MARKER,
  BACKUP_DOCUMENT_VERSION,
  BACKUP_SCHEMA_VERSION,
  validateBackupTables,
} from '../../domain/backup/BackupDocument'
import type { BackupStore } from '../../domain/backup/ports/BackupStore'
import type { FileStore } from '../../domain/conversation/ports/FileStore'
import { toBase64 } from '../../domain/shared/base64'
import type { Clock } from '../../domain/shared/Clock'

export interface ExportBackupDeps {
  readonly backup: BackupStore
  readonly files: FileStore
  readonly clock: Clock
}

export async function exportBackup(deps: ExportBackupDeps): Promise<BackupDocument> {
  const tables = validateBackupTables(await deps.backup.dumpTables())
  const rows = tables.attachment ?? []
  const files = new Map<string, string>()
  for (const row of rows) {
    const storageName = String(row.storage_name)
    files.set(storageName, toBase64(await deps.files.read(storageName)))
  }
  return {
    v: BACKUP_DOCUMENT_VERSION,
    app: BACKUP_APP_MARKER,
    exportedAt: deps.clock.now(),
    schemaVersion: BACKUP_SCHEMA_VERSION,
    tables,
    attachments: rows.map((row) => ({
      row,
      bytesBase64: files.get(String(row.storage_name)) as string,
    })),
  }
}
