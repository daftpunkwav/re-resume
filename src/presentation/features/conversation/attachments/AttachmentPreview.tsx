/**
 * @file AttachmentPreview
 * @description The enlarged view of one attached image. It is a modal surface
 * with the same keyboard contract as the design system's dialog: focus moves
 * in, Tab stays in, Escape and the scrim close it, focus returns to the
 * thumbnail that opened it.
 *
 * Constraints:
 * - The image is scaled down to the viewport, never the raw pixel size; a
 *   screenshot that is 3000 px wide must not force a horizontal scrollbar.
 * - The bytes are read through the capability on open, so the lightbox of a
 *   stored message works after a restart even though no object URL survived.
 */

import { useFocusTrap } from '../../../app/useFocusTrap'
import { IconButton } from '../../../app/components/IconButton'
import type { Attachment } from '../../../../domain/conversation/Attachment'
import { attachmentLabel, formatAttachmentSize } from './attachmentFormat'
import { useAttachmentImageUrl } from './useAttachmentImageUrl'

export interface AttachmentPreviewProps {
  readonly attachment: Attachment
  readonly index: number
  readonly onClose: () => void
}

export function AttachmentPreview({ attachment, index, onClose }: AttachmentPreviewProps) {
  const panelRef = useFocusTrap<HTMLDivElement>({ active: true, onEscape: onClose })
  const image = useAttachmentImageUrl(attachment)
  const label = attachmentLabel(attachment, index)

  return (
    <div
      className="attachment-preview-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="attachment-preview"
        role="dialog"
        aria-modal="true"
        aria-label={attachmentPreviewTitle(label)}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="attachment-preview-head">
          <span className="attachment-preview-copy">
            <span className="attachment-preview-name">{label}</span>
            <span className="attachment-preview-meta">
              {attachment.mimeType} · {formatAttachmentSize(attachment.byteSize)}
            </span>
          </span>
          <IconButton icon="close" label="关闭图片预览" onClick={onClose} />
        </header>
        <div className="attachment-preview-body">
          {image.kind === 'ready' ? (
            <img className="attachment-preview-image" src={image.url} alt={label} />
          ) : image.kind === 'failed' ? (
            <p className="attachment-preview-fallback" role="alert">
              这张图片的原始文件没有找到。
            </p>
          ) : image.kind === 'unavailable' ? (
            <p className="attachment-preview-fallback">
              当前环境无法显示图片预览。
            </p>
          ) : (
            <p className="attachment-preview-fallback">正在读取图片…</p>
          )}
        </div>
      </div>
    </div>
  )
}

function attachmentPreviewTitle(label: string): string {
  return `图片预览：${label}`
}
