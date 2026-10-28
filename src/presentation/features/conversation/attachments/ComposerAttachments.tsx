/**
 * @file ComposerAttachments
 * @description The attachment row above the composer input: chips for the
 * images of this turn, the in-progress state, the ingest refusal and the
 * warning for a model that cannot read images.
 *
 * Constraints:
 * - The row never decides what is valid; the store already refused invalid
 *   files and put the reason here.
 * - The model warning is informational and blocks sending from the composer,
 *   but it never removes the images the user attached.
 */

import type { ReadableError } from '../../../app/errorMessages'
import { IconButton } from '../../../app/components/IconButton'
import type { ComposerAttachment } from '../stores/conversationStore'
import { AttachmentChip } from './AttachmentChip'

export interface ComposerAttachmentsProps {
  readonly attachments: readonly ComposerAttachment[]
  readonly ingesting: number
  readonly error: ReadableError | null
  /** False when the active model explicitly refuses image input. */
  readonly modelSupportsImages: boolean
  readonly onRemove: (attachmentId: ComposerAttachment['attachment']['id']) => void
  readonly onDismissError: () => void
}

export function ComposerAttachments({
  attachments,
  ingesting,
  error,
  modelSupportsImages,
  onRemove,
  onDismissError,
}: ComposerAttachmentsProps) {
  const unsupported = attachments.length > 0 && !modelSupportsImages
  if (attachments.length === 0 && ingesting === 0 && error === null && !unsupported) {
    return null
  }
  return (
    <div className="composer-attachments-region">
      {attachments.length === 0 && ingesting === 0 ? null : (
        <ul className="composer-attachments" aria-label="本轮附带的图片">
          {attachments.map((entry, index) => (
            <AttachmentChip
              key={entry.attachment.id}
              attachment={entry.attachment}
              file={entry.file}
              index={index}
              onRemove={() => onRemove(entry.attachment.id)}
            />
          ))}
          {ingesting === 0 ? null : (
            <li className="composer-attachment composer-attachment-ingesting" role="status">
              正在添加图片…
            </li>
          )}
        </ul>
      )}
      {unsupported ? (
        <p className="composer-attachment-warning" role="status">
          当前模型不支持图片输入。请切换到支持图片的模型，或移除图片后改用文本粘贴。
        </p>
      ) : null}
      {error === null ? null : (
        <p className="composer-attachment-error" role="alert">
          <span>{error.message}</span>
          <IconButton
            icon="close"
            label="关闭附件提示"
            size="small"
            onClick={onDismissError}
          />
        </p>
      )}
    </div>
  )
}
