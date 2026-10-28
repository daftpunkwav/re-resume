/**
 * @file clearAllData
 * @description Deletes every row of every table, the attachment files beside
 * them and every provider credential.
 *
 * Constraints:
 * - The database is cleared first: rows that name bytes are the truth, and a
 *   missing file behind a removed row is harmless while a row whose file was
 *   removed would be a broken reference.
 * - Credentials are removed after the database is clear. A secret store that
 *   cannot forget one is reported, because data the user asked to erase would
 *   otherwise survive in the encrypted store with no row naming it.
 * - A file that cannot be deleted is reported after the database is already
 *   clear; the remaining bytes are unreferenced and the cleanup entry can remove
 *   them later.
 */

import type { BackupStore } from '../../domain/backup/ports/BackupStore'
import type { FileStore } from '../../domain/conversation/ports/FileStore'
import type { SecretStore } from '../../domain/generation/ports/SecretStore'

export interface ClearAllDataDeps {
  readonly backup: BackupStore
  readonly files: FileStore
  readonly secrets: SecretStore
}

export interface ClearAllDataResult {
  readonly removedAttachments: number
  readonly removedSecrets: number
  /** Files the sweep could not delete; the data is clear regardless. */
  readonly undeletedFiles: readonly string[]
  /** Credentials the store could not forget; the data is clear regardless. */
  readonly undeletedSecrets: readonly string[]
}

export async function clearAllData(deps: ClearAllDataDeps): Promise<ClearAllDataResult> {
  const storageNames = await deps.backup.listAttachmentStorageNames()
  const secretRefs = await deps.backup.listProviderSecretRefs()
  await deps.backup.clearAll()
  const undeletedSecrets: string[] = []
  for (const ref of secretRefs) {
    try {
      await deps.secrets.remove(ref)
    } catch {
      undeletedSecrets.push(ref)
    }
  }
  const undeletedFiles: string[] = []
  for (const storageName of storageNames) {
    try {
      await deps.files.delete(storageName)
    } catch {
      undeletedFiles.push(storageName)
    }
  }
  return {
    removedAttachments: storageNames.length,
    removedSecrets: secretRefs.length,
    undeletedFiles,
    undeletedSecrets,
  }
}
