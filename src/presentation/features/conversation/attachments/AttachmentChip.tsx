/**
 * @file AttachmentChip
 * @description One image chip in the composer: a small thumbnail, its size, and
 * the remove action.
 *
 * Constraints:
 * - The chip is a list item inside the composer's attachment row; the remove
 *   button carries the accessible name, the thumbnail is decorative.
 */

import type { Attachment } from '../../../../domain/conversation/Attachment'
import { IconButton } from '../../../app/components/IconButton'
import { attachmentLabel, formatAttachmentSize } from './attachmentFormat'
import { useAttachmentImageUrl } from './useAttachmentImageUrl'

export interface AttachmentChipProps {
  readonly attachment: Attachment
  /** The still-open picked file when the draft has one. */
  readonly file: File | null
  readonly index: number
  readonly onRemove: () => void
}

export function AttachmentChip({ attachment, file, index, onRemove }: AttachmentChipProps) {
  const label = attachmentLabel(attachment, index, file)
  const image = useAttachmentImageUrl(attachment, file)
  return (
    <li className="composer-attachment">
      <span className="composer-attachment-thumb" aria-hidden="true">
        {image.kind === 'ready' ? <img src={image.url} alt="" /> : <span>图片</span>}
      </span>
      <span className="composer-attachment-copy">
        <span className="composer-attachment-name" title={label}>
          {label}
        </span>
        <span className="composer-attachment-size">
          {formatAttachmentSize(attachment.byteSize)}
        </span>
      </span>
      <IconButton icon="close" label={`移除${label}`} size="small" onClick={onRemove} />
    </li>
  )
}
