/**
 * @file AttachmentFileChip
 * @description One picked image that has not been sent yet, shown by the job
 * screenshot dialog: a thumbnail from the open file, its name and size, and the
 * remove action.
 *
 * Constraints:
 * - The dialog picks files and hands them to the store only on confirm, so the
 *   chip paints the local file instead of a stored attachment row.
 * - A platform without object URLs (the test environment) shows the name only;
 *   the image still arrives at the store once the dialog confirms.
 * - The preview URL comes from the shared per-file cache, so a development
 *   remount does not revoke the URL the next mount still paints.
 */

import { IconButton } from '../../../app/components/IconButton'
import { filePreviewUrl, formatAttachmentSize } from './attachmentFormat'

export interface AttachmentFileChipProps {
  readonly file: File
  readonly index: number
  readonly onRemove: () => void
}

export function AttachmentFileChip({ file, index, onRemove }: AttachmentFileChipProps) {
  const label = file.name === '' ? `截图 ${String(index + 1)}` : file.name
  const url = filePreviewUrl(file)

  return (
    <li className="composer-attachment">
      <span className="composer-attachment-thumb" aria-hidden="true">
        {url === null ? <span>截图</span> : <img src={url} alt="" />}
      </span>
      <span className="composer-attachment-copy">
        <span className="composer-attachment-name" title={label}>
          {label}
        </span>
        <span className="composer-attachment-size">
          {formatAttachmentSize(file.size)}
        </span>
      </span>
      <IconButton icon="close" label={`移除${label}`} size="small" onClick={onRemove} />
    </li>
  )
}
