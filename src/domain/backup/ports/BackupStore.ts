/**
 * @file BackupStore
 * @description The persistence side of backup: read every table, replace every
 * table in one transaction, clear the data, and find the attachments nothing
 * refers to any more.
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - `replaceAll` is one transaction: a document is applied completely or not at
 *   all. A caller never sees half of a restored backup.
 * - Attachment bytes are not this port's subject: the file store owns them, and
 *   the caller keeps the two in step.
 */

import type { BackupTables } from '../BackupDocument'
import type { DateTime } from '../../shared/DateTime'

/** One attachment row whose bytes no other row refers to. */
export interface OrphanAttachment {
  readonly id: string
  readonly storageName: string
}

export interface BackupStore {
  /** Every row of every table in the backup schema, without ordering guarantees. */
  dumpTables(): Promise<BackupTables>
  /** Deletes every row and writes the document's rows, in one transaction. */
  replaceAll(tables: BackupTables): Promise<void>
  /** Deletes every row of every table, in one transaction. */
  clearAll(): Promise<void>
  /** The attachments created before the cutoff that no message, posting or canvas block names. */
  listOrphanAttachments(createdBefore: DateTime): Promise<readonly OrphanAttachment[]>
  /** Deletes the named attachment rows. */
  deleteAttachments(ids: readonly string[]): Promise<void>
  /** Storage names of every attachment row, for clearing the bytes beside them. */
  listAttachmentStorageNames(): Promise<readonly string[]>
  /** Secret references of every provider row, for clearing the credentials beside them. */
  listProviderSecretRefs(): Promise<readonly string[]>
}
