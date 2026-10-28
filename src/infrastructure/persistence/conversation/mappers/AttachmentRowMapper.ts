/**
 * @file AttachmentRowMapper
 * @description Row to domain conversion for attachment metadata. The bytes are
 * not in the row; storage name and digest are enough to find them.
 */

import { isAttachmentKind } from '../../../../domain/conversation/Attachment'
import type { Attachment } from '../../../../domain/conversation/Attachment'
import type { DateTime } from '../../../../domain/shared/DateTime'
import { asAttachmentId } from '../../../../domain/shared/branded-id'
import {
  nullableInteger,
  requiredInteger,
  requiredText,
  requiredTimestamp,
} from './ConversationRowMapper'
import { RowMappingError } from '../../JsonEnvelope'

export interface AttachmentRow {
  readonly id: unknown
  readonly kind: unknown
  readonly mime_type: unknown
  readonly byte_size: unknown
  readonly storage_name: unknown
  readonly width: unknown
  readonly height: unknown
  readonly sha256: unknown
  readonly created_at: unknown
}

export function toAttachmentRow(attachment: Attachment): {
  readonly id: string
  readonly kind: string
  readonly mime_type: string
  readonly byte_size: number
  readonly storage_name: string
  readonly width: number | null
  readonly height: number | null
  readonly sha256: string
  readonly created_at: DateTime
} {
  return {
    id: attachment.id,
    kind: attachment.kind,
    mime_type: attachment.mimeType,
    byte_size: attachment.byteSize,
    storage_name: attachment.storageName,
    width: attachment.width,
    height: attachment.height,
    sha256: attachment.sha256,
    created_at: attachment.createdAt,
  }
}

export function fromAttachmentRow(row: AttachmentRow): Attachment {
  const kind = row.kind
  if (!isAttachmentKind(kind)) {
    throw new RowMappingError('attachment.kind', 'value is not one of the attachment kinds', kind)
  }
  const byteSize = requiredInteger(row.byte_size, 'attachment.byte_size')
  if (byteSize <= 0) {
    throw new RowMappingError('attachment.byte_size', 'expected a positive size', byteSize)
  }
  const sha256 = requiredText(row.sha256, 'attachment.sha256')
  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new RowMappingError('attachment.sha256', 'expected a lowercase hexadecimal SHA-256 digest', sha256)
  }
  return {
    id: asAttachmentId(requiredText(row.id, 'attachment.id')),
    kind,
    mimeType: requiredText(row.mime_type, 'attachment.mime_type'),
    byteSize,
    storageName: requiredText(row.storage_name, 'attachment.storage_name'),
    width: nullableInteger(row.width, 'attachment.width'),
    height: nullableInteger(row.height, 'attachment.height'),
    sha256,
    createdAt: requiredTimestamp(row.created_at, 'attachment.created_at'),
  }
}
