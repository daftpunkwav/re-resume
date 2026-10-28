/**
 * @file cleanupOrphanAttachments
 * @description Removes attachment rows and bytes that were created more than a
 * day ago and that no message, job posting or canvas block refers to.
 *
 * Constraints:
 * - The age window keeps an attachment whose upload is still being composed:
 *   the message that will name it does not exist yet.
 * - A file that cannot be deleted stays on disk while its row is removed; the
 *   next sweep reports it, and it is invisible to the application either way.
 */

import type { BackupStore } from '../../domain/backup/ports/BackupStore'
import type { FileStore } from '../../domain/conversation/ports/FileStore'
import type { Clock } from '../../domain/shared/Clock'
import type { DateTime } from '../../domain/shared/DateTime'

/** Attachments younger than this are still being composed, not abandoned. */
export const ORPHAN_ATTACHMENT_MIN_AGE_MS = 24 * 60 * 60 * 1000

export interface CleanupOrphanAttachmentsDeps {
  readonly backup: BackupStore
  readonly files: FileStore
  readonly clock: Clock
}

export interface CleanupOrphanAttachmentsResult {
  readonly removed: number
  readonly undeletedFiles: readonly string[]
}

export async function cleanupOrphanAttachments(
  deps: CleanupOrphanAttachmentsDeps,
): Promise<CleanupOrphanAttachmentsResult> {
  const cutoff = cutoffBefore(deps.clock.now())
  const orphans = await deps.backup.listOrphanAttachments(cutoff)
  if (orphans.length === 0) return { removed: 0, undeletedFiles: [] }
  const undeletedFiles: string[] = []
  for (const orphan of orphans) {
    try {
      await deps.files.delete(orphan.storageName)
    } catch {
      undeletedFiles.push(orphan.storageName)
    }
  }
  await deps.backup.deleteAttachments(orphans.map((orphan) => orphan.id))
  return { removed: orphans.length, undeletedFiles }
}

/** ISO timestamp of `now` minus the minimum age. */
export function cutoffBefore(now: DateTime): DateTime {
  return new Date(Date.parse(now) - ORPHAN_ATTACHMENT_MIN_AGE_MS).toISOString() as DateTime
}
