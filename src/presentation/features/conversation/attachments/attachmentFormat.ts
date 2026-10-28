/**
 * @file attachmentFormat
 * @description Small readers the attachment chips and the image lightbox share:
 * a human size, a display label, an object URL that only exists where the
 * platform can make one, and the image files of a paste or drop event.
 *
 * Responsibilities:
 * - Format a byte count and name an attachment that has no stored file name
 * - Create and revoke object URLs behind a capability check
 * - Pick the image files out of a clipboard or a drag data transfer
 *
 * Constraints:
 * - The attachment model stores no original file name; a stored attachment is
 *   labelled by its kind and position instead of inventing a name.
 * - jsdom has neither `URL.createObjectURL` nor a layout engine; every helper
 *   degrades to "no preview" rather than failing the surface that calls it.
 */

import type { Attachment } from '../../../../domain/conversation/Attachment'

const MEBIBYTE = 1024 * 1024
const KIBIBYTE = 1024

/** A short, localised size such as `742 KB` or `2.1 MB`. */
export function formatAttachmentSize(byteSize: number): string {
  if (!Number.isFinite(byteSize) || byteSize < 0) return '—'
  if (byteSize >= MEBIBYTE) return `${(byteSize / MEBIBYTE).toFixed(1)} MB`
  if (byteSize >= KIBIBYTE) return `${Math.round(byteSize / KIBIBYTE).toString()} KB`
  return `${byteSize.toString()} B`
}

/**
 * The label a chip shows. A draft keeps the picked file's own name; a stored
 * attachment (or a draft restored after a failed send) is `图片 N`.
 */
export function attachmentLabel(
  attachment: Attachment,
  index: number,
  file?: File | null,
): string {
  if (file !== undefined && file !== null && file.name !== '') return file.name
  return attachment.kind === 'image' ? `图片 ${String(index + 1)}` : '附件'
}

/** The accessible label of the button that opens the preview. */
export function attachmentPreviewLabel(label: string): string {
  return `查看图片：${label}`
}

/** An object URL for the bytes, or null where the platform cannot create one. */
export function createPreviewUrl(bytes: Uint8Array, mimeType: string): string | null {
  if (typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(new Blob([bytes as BufferSource], { type: mimeType }))
}

/**
 * The object URL of a picked file, cached for the life of the file. A draft chip
 * is unmounted and remounted by React's development double-invoke, so a URL
 * that the first mount revoked would paint as a broken image; the cache makes
 * the URL outlive one mount. Preview is bounded by the files the user picked in
 * this session.
 */
const filePreviewUrls = new WeakMap<File, string>()

export function filePreviewUrl(file: File): string | null {
  if (typeof URL.createObjectURL !== 'function') return null
  const cached = filePreviewUrls.get(file)
  if (cached !== undefined) return cached
  const url = URL.createObjectURL(file)
  filePreviewUrls.set(file, url)
  return url
}

export function revokePreviewUrl(url: string | null): void {
  if (url !== null && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

/** True when the file is one of the four image types the attachment domain allows. */
function isImageFile(file: File): boolean {
  return (
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    file.type === 'image/webp' ||
    file.type === 'image/gif'
  )
}

/** The image files of a clipboard event, in clipboard order. */
export function imageFilesFromClipboard(data: DataTransfer | null): readonly File[] {
  if (data === null) return []
  const files = [...data.files].filter(isImageFile)
  if (files.length > 0) return files
  const fromItems: File[] = []
  for (const item of [...data.items]) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file !== null && isImageFile(file)) fromItems.push(file)
  }
  return fromItems
}

/** The image files of a drag data transfer, in transfer order. */
export function imageFilesFromDataTransfer(data: DataTransfer | null): readonly File[] {
  if (data === null) return []
  return [...data.files].filter(isImageFile)
}
