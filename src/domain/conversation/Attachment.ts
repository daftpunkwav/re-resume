/**
 * @file Attachment
 * @description A file the user attached to a turn: an image for a multimodal
 * model or a job description document. Bytes live on disk (or in the preview
 * file store); this type is the row that describes them.
 *
 * Responsibilities:
 * - Declare the persisted metadata shape
 * - Own the MIME whitelist and the size/count limits every write path applies
 * - Derive the storage name from the identifier and the MIME type
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - The storage name carries no path separator: it is joined to a fixed
 *   directory by the file-store implementation, never user input.
 */

import { DomainError } from '../shared/DomainError'
import type { DateTime } from '../shared/DateTime'
import type { AttachmentId } from '../shared/branded-id'

export const ATTACHMENT_KINDS = ['image', 'file'] as const

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const

export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number]

const IMAGE_MIME_TYPES: readonly AttachmentMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

/** Largest single attachment, in bytes. */
export const MAX_ATTACHMENT_BYTE_SIZE = 5 * 1024 * 1024

/** Largest number of attachments one message may carry. */
export const MAX_MESSAGE_ATTACHMENT_COUNT = 4

/** Largest combined attachment size one message may carry, in bytes. */
export const MAX_MESSAGE_ATTACHMENT_BYTE_SIZE = 12 * 1024 * 1024

export interface Attachment {
  readonly id: AttachmentId
  readonly kind: AttachmentKind
  readonly mimeType: string
  readonly byteSize: number
  /** `<id>.<ext>`, no path separator. */
  readonly storageName: string
  readonly width: number | null
  readonly height: number | null
  /** Lowercase hexadecimal SHA-256 digest of the bytes. */
  readonly sha256: string
  readonly createdAt: DateTime
}

export function isAttachmentMimeType(value: unknown): value is AttachmentMimeType {
  return (
    typeof value === 'string' && (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value)
  )
}

export function isAttachmentKind(value: unknown): value is AttachmentKind {
  return typeof value === 'string' && (ATTACHMENT_KINDS as readonly string[]).includes(value)
}

function isImageMimeType(mimeType: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)
}

/** The kind a supported MIME type belongs to, or null for an unsupported one. */
export function attachmentKindForMime(mimeType: string): AttachmentKind | null {
  if (!isAttachmentMimeType(mimeType)) return null
  return isImageMimeType(mimeType) ? 'image' : 'file'
}

const MIME_EXTENSIONS: Readonly<Record<AttachmentMimeType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

export function attachmentStorageName(id: AttachmentId, mimeType: AttachmentMimeType): string {
  return `${id}.${MIME_EXTENSIONS[mimeType]}`
}

/**
 * Enforces the per-attachment rules shared by every write path: the MIME type
 * must be supported and the bytes must fit the single-attachment ceiling.
 */
export function assertAttachmentAllowed(mimeType: string, byteSize: number): AttachmentMimeType {
  if (!isAttachmentMimeType(mimeType)) {
    throw new DomainError(
      'unsupportedImageType',
      `不支持的附件类型 ${mimeType}，仅支持 ${ATTACHMENT_MIME_TYPES.join('、')}。`,
    )
  }
  if (!Number.isInteger(byteSize) || byteSize <= 0) {
    throw new DomainError('invalidFieldValue', `附件大小必须为正整数，收到 ${byteSize}。`)
  }
  if (byteSize > MAX_ATTACHMENT_BYTE_SIZE) {
    throw new DomainError(
      'attachmentTooLarge',
      `单个附件不能超过 ${formatMebibytes(MAX_ATTACHMENT_BYTE_SIZE)}。`,
    )
  }
  return mimeType
}

/**
 * Enforces the per-message rules. Called both when composing a message with
 * existing attachments and when ingesting a new one for a draft message.
 */
export function assertMessageAttachmentsAllowed(
  attachments: readonly { readonly mimeType: string; readonly byteSize: number }[],
): void {
  if (attachments.length > MAX_MESSAGE_ATTACHMENT_COUNT) {
    throw new DomainError(
      'attachmentTooLarge',
      `一条消息最多携带 ${MAX_MESSAGE_ATTACHMENT_COUNT} 个附件。`,
    )
  }
  let total = 0
  for (const attachment of attachments) total += attachment.byteSize
  if (total > MAX_MESSAGE_ATTACHMENT_BYTE_SIZE) {
    throw new DomainError(
      'attachmentTooLarge',
      `一条消息的附件总大小不能超过 ${formatMebibytes(MAX_MESSAGE_ATTACHMENT_BYTE_SIZE)}。`,
    )
  }
}

function formatMebibytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`
}
