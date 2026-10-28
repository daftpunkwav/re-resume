/**
 * @file MessageAttachments
 * @description The image row of a user turn: thumbnails at a bounded size, and
 * the lightbox a thumbnail opens.
 *
 * Constraints:
 * - The row knows only the attachment rows; the bytes are read per thumbnail
 *   when it paints, so a transcript with many messages does not keep every
 *   image in memory.
 * - One thumbnail is larger than a grid tile so a screenshot stays readable
 *   without opening the lightbox.
 */

import { useState } from 'react'
import type { Attachment } from '../../../../domain/conversation/Attachment'
import { AttachmentPreview } from './AttachmentPreview'
import { attachmentLabel, attachmentPreviewLabel } from './attachmentFormat'
import { useAttachmentImageUrl } from './useAttachmentImageUrl'

export interface MessageAttachmentsProps {
  readonly attachments: readonly Attachment[]
}

export function MessageAttachments({ attachments }: MessageAttachmentsProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  // The conversation sends images only; a file row (a PDF from another surface)
  // has no thumbnail here and is skipped rather than shown as a broken image.
  const images = attachments.filter((attachment) => attachment.kind === 'image')
  if (images.length === 0) return null
  const preview = previewIndex === null ? null : (images[previewIndex] ?? null)
  return (
    <>
      <ul
        className="message-attachments"
        data-count={images.length > 1 ? 'many' : 'one'}
        aria-label="随消息发送的图片"
      >
        {images.map((attachment, index) => (
          <MessageAttachmentThumb
            key={attachment.id}
            attachment={attachment}
            index={index}
            onOpen={() => setPreviewIndex(index)}
          />
        ))}
      </ul>
      {preview === null || previewIndex === null ? null : (
        <AttachmentPreview
          attachment={preview}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </>
  )
}

interface MessageAttachmentThumbProps {
  readonly attachment: Attachment
  readonly index: number
  readonly onOpen: () => void
}

function MessageAttachmentThumb({ attachment, index, onOpen }: MessageAttachmentThumbProps) {
  const label = attachmentLabel(attachment, index)
  const image = useAttachmentImageUrl(attachment)
  // Reserve the laid-out shape until the bytes arrive, so the transcript does
  // not jump when a tall screenshot paints.
  const ratio =
    attachment.width !== null && attachment.height !== null && attachment.width > 0
      ? attachment.width / attachment.height
      : 4 / 3
  return (
    <li className="message-attachment">
      <button
        type="button"
        className="message-attachment-button"
        aria-label={attachmentPreviewLabel(label)}
        onClick={onOpen}
      >
        {image.kind === 'ready' ? (
          <img
            className="message-attachment-image"
            src={image.url}
            alt={label}
            style={{ aspectRatio: `${String(ratio)}` }}
          />
        ) : (
          <span className="message-attachment-placeholder" style={{ aspectRatio: `${String(ratio)}` }}>
            {image.kind === 'failed' ? '图片不可用' : '图片'}
          </span>
        )}
      </button>
    </li>
  )
}
