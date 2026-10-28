/**
 * @file importBackup
 * @description Applies a backup document: validate every row, write the
 * attachment bytes, replace all data in one transaction, then delete the
 * credentials of the restored provider rows.
 *
 * Responsibilities:
 * - Refuse a document of another version/schema or with any malformed row
 *   before the database is touched (spec section 8.7)
 * - Restore the attachment bytes the document carries
 * - Replace the whole database content in one transaction
 * - Leave no credential behind for a provider row the backup restores: the
 *   document never contains keys, and an old secret under a reused identifier
 *   would otherwise silently become the restored service's key
 *
 * Constraints:
 * - Nothing is written when validation fails; the current data is untouched.
 * - Attachment files are written before the transaction because the file store
 *   is not transactional. A failed transaction leaves unreferenced files, which
 *   the orphan cleanup removes; a missing row without bytes never occurs.
 */

import type { BackupDocument, BackupImportSummary } from '../../domain/backup/BackupDocument'
import { parseBackupDocument, summarizeBackupDocument } from '../../domain/backup/BackupDocument'
import type { BackupStore } from '../../domain/backup/ports/BackupStore'
import type { FileStore } from '../../domain/conversation/ports/FileStore'
import type { SecretStore } from '../../domain/generation/ports/SecretStore'

export interface ImportBackupDeps {
  readonly backup: BackupStore
  readonly files: FileStore
  readonly secrets: SecretStore
}

/** Validates the document and restores it; the returned summary names the row counts. */
export async function importBackup(
  deps: ImportBackupDeps,
  raw: unknown,
): Promise<BackupImportSummary> {
  const document: BackupDocument = parseBackupDocument(raw)
  for (const attachment of document.attachments) {
    const bytes = decodeBase64(attachment.bytesBase64)
    await deps.files.write(String(attachment.row.storage_name), bytes)
  }
  await deps.backup.replaceAll(document.tables)
  for (const provider of document.tables.provider_config ?? []) {
    await deps.secrets.remove(String(provider.secret_ref))
  }
  return summarizeBackupDocument(document)
}

/** Validates without writing, for the confirmation step before a restore. */
export function inspectBackup(raw: unknown): BackupImportSummary {
  return summarizeBackupDocument(parseBackupDocument(raw))
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
