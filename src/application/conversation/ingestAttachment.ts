/**
 * @file ingestAttachment
 * @description Stores an attachment once and returns its metadata row. The bytes
 * are written before the row: a row that names no stored bytes would render as a
 * broken chip and could never be repaired, while a stored file with no row is
 * harmless and is cleaned up by the orphan sweep.
 *
 * Responsibilities:
 * - Validate the MIME type and the size limits of the attachment domain
 * - Compute the SHA-256 digest and reuse the row of an identical file
 * - Read the pixel size of an image when the platform can decode it
 *
 * Constraints:
 * - The only hashing primitive used is Web Crypto; this module never imports a
 *   Node built-in, because it is bundled into the window.
 * - A platform without `createImageBitmap` (the test environment) records null
 *   dimensions rather than failing the ingest.
 */

import {
  assertAttachmentAllowed,
  attachmentKindForMime,
  attachmentStorageName,
} from '../../domain/conversation/Attachment'
import type { Attachment, AttachmentMimeType } from '../../domain/conversation/Attachment'
import type { AttachmentRepository } from '../../domain/conversation/ports/AttachmentRepository'
import type { FileStore } from '../../domain/conversation/ports/FileStore'
import { DomainError } from '../../domain/shared/DomainError'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import { asAttachmentId } from '../../domain/shared/branded-id'

export interface IngestAttachmentDeps {
  readonly attachments: AttachmentRepository
  readonly fileStore: FileStore
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface IngestAttachmentInput {
  readonly kind: 'image' | 'file'
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export async function ingestAttachment(
  deps: IngestAttachmentDeps,
  input: IngestAttachmentInput,
): Promise<Attachment> {
  const mimeType = assertAttachmentAllowed(input.mimeType, input.bytes.byteLength)
  const derivedKind = attachmentKindForMime(mimeType)
  if (derivedKind === null || derivedKind !== input.kind) {
    throw new DomainError(
      'unsupportedImageType',
      `附件类型 ${input.kind}/${input.mimeType} 与内容类型不一致。`,
    )
  }
  const sha256 = await sha256Hex(input.bytes)
  const existing = await deps.attachments.findBySha256(sha256)
  if (existing !== null) return existing

  const id = asAttachmentId(deps.ids.next())
  const storageName = attachmentStorageName(id, mimeType as AttachmentMimeType)
  const dimensions =
    derivedKind === 'image' ? await readImageSize(input.bytes, mimeType) : null
  await deps.fileStore.write(storageName, input.bytes)
  try {
    const attachment: Attachment = {
      id,
      kind: derivedKind,
      mimeType,
      byteSize: input.bytes.byteLength,
      storageName,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      sha256,
      createdAt: deps.clock.now(),
    }
    await deps.attachments.insert(attachment)
    return attachment
  } catch (failure) {
    // The row is the thing the interface reads; without it the stored bytes are
    // unreachable, so the failed ingest does not leave them behind.
    await deps.fileStore.delete(storageName).catch((cleanupFailure: unknown) => {
      throw new Error(
        `Storing the attachment row failed and the stored bytes could not be removed either: ${describe(cleanupFailure)}`,
        { cause: failure },
      )
    })
    throw failure
  }
}

/** Lowercase hexadecimal SHA-256 digest, using the Web Crypto available in the window. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) {
    throw new DomainError('invalidFieldValue', '附件内容为空。')
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readImageSize(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ readonly width: number; readonly height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BufferSource], { type: mimeType }))
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    // A corrupt image is still stored: the provider will reject it, and the
    // interface can show the attachment without claiming a pixel size it does
    // not know.
    return null
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
