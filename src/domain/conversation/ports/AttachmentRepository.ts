/**
 * @file AttachmentRepository
 * @description Persistence port for attachment metadata. The bytes are stored
 * through FileStore under the row's storage name.
 *
 * Constraints:
 * - A digest identifies the bytes, so ingesting the same file twice reuses the
 *   existing row instead of storing a second copy.
 */

import type { Attachment } from '../Attachment'
import type { AttachmentId } from '../../shared/branded-id'

export interface AttachmentRepository {
  findById(id: AttachmentId): Promise<Attachment | null>
  findBySha256(sha256: string): Promise<Attachment | null>
  listByIds(ids: readonly AttachmentId[]): Promise<readonly Attachment[]>
  insert(attachment: Attachment): Promise<void>
}
