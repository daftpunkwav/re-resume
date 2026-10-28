/**
 * @file Composer
 * @description The input region: a growing textarea, the context chips and
 * image chips of the turn, the model control and the send/stop button.
 *
 * Responsibilities:
 * - Enter sends, Shift+Enter inserts a line break, and an IME composition owns
 *   every key it sees
 * - Accept images through paste, the file picker and drag and drop, and let the
 *   user remove one before sending
 * - Refuse to send images to a model that cannot read them, with the reason and
 *   the way back to a text-only turn
 * - Swap the send button for a stop button while an answer streams
 * - Keep the draft when the send fails; the store restores it
 *
 * Constraints:
 * - The draft (text, chips and images) lives in the conversation store, so an
 *   unrelated re-render never loses it.
 * - The composer never reads attachment bytes: the store ingests them and the
 *   chips render from the stored row or the still-open file.
 */

import { useRef } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { Button } from '../../app/components/Button'
import { useShellStore } from '../../app/stores/shellStore'
import { ComposerAttachments } from './attachments/ComposerAttachments'
import { IMAGE_INPUT_ACCEPT, useImageIntake } from './attachments/useImageIntake'
import { ContextChip } from './ContextChip'
import { FeatureIcon } from './icons'
import { useAutoResize } from './hooks'
import { ModelPicker } from './ModelPicker'
import { useConversationStore } from './stores/conversationStore'
import { useProviderStore } from './stores/providerStore'
import { useRunStore } from './stores/runStore'

export interface ComposerProps {
  /** The header and the empty state focus the same field. */
  readonly inputRef: RefObject<HTMLTextAreaElement | null>
}

export function Composer({ inputRef }: ComposerProps) {
  const text = useConversationStore((state) => state.composer.text)
  const contexts = useConversationStore((state) => state.composer.contexts)
  const attachments = useConversationStore((state) => state.composer.attachments)
  const attachmentIngesting = useConversationStore((state) => state.attachmentIngesting)
  const attachmentError = useConversationStore((state) => state.attachmentError)
  const setComposerText = useConversationStore((state) => state.setComposerText)
  const removeContext = useConversationStore((state) => state.removeContext)
  const attachFiles = useConversationStore((state) => state.attachFiles)
  const removeAttachment = useConversationStore((state) => state.removeAttachment)
  const clearAttachmentError = useConversationStore((state) => state.clearAttachmentError)
  const send = useConversationStore((state) => state.send)
  const cancel = useConversationStore((state) => state.cancel)
  const runStatus = useRunStore((state) => state.status)
  const providerStatus = useProviderStore((state) => state.status)
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const openSettings = useShellStore((state) => state.openSettings)
  const composing = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useAutoResize(inputRef, text)

  const busy = runStatus !== 'idle'
  const activeProvider =
    providers.find((entry) => entry.config.id === activeProviderId) ?? null
  // Unknown (no provider yet) does not warn: the setup entry already explains
  // why nothing can be sent, and the run would stop with its own message.
  const modelRefusesImages = activeProvider !== null && !activeProvider.supportsImages
  const imageIntake = useImageIntake(
    (files) => {
      void attachFiles(files)
    },
    busy,
    fileInputRef,
  )
  const canSend =
    (text.trim() !== '' || attachments.length > 0) &&
    !busy &&
    attachmentIngesting === 0 &&
    !modelRefusesImages
  const missingModel = providerStatus === 'ready' && providers.length === 0

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // The composition flag is the reliable signal across engines; the native
    // event flag is checked as well because some WebViews report only one.
    if (composing.current || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!canSend) return
    void send()
  }

  return (
    <div
      className="composer-dock"
      onDragEnter={imageIntake.onDragEnter}
      onDragOver={imageIntake.onDragOver}
      onDragLeave={imageIntake.onDragLeave}
      onDrop={imageIntake.onDrop}
    >
      <div className="composer" data-busy={busy || undefined} data-dragging={imageIntake.dragging || undefined}>
        <ComposerAttachments
          attachments={attachments}
          ingesting={attachmentIngesting}
          error={attachmentError}
          modelSupportsImages={!modelRefusesImages}
          onRemove={(attachmentId) => removeAttachment(attachmentId)}
          onDismissError={clearAttachmentError}
        />
        {contexts.length === 0 ? null : (
          <div className="composer-contexts" aria-label="本轮附带的上下文">
            {contexts.map((chip) => (
              <ContextChip
                key={`${chip.context.kind}:${chip.context.refId}`}
                kind={chip.context.kind}
                label={chip.label}
                onRemove={() => removeContext(chip.context)}
              />
            ))}
          </div>
        )}
        <div className="composer-input-row">
          <textarea
            className="composer-input"
            ref={inputRef}
            rows={1}
            value={text}
            aria-label="输入消息"
            aria-describedby="composer-hint"
            placeholder={
              missingModel
                ? '先配置模型服务，再开始对话…'
                : attachments.length > 0
                  ? '可以补充一句说明，例如「针对这个岗位做简历」…'
                  : '描述目标岗位，或直接问助手任何关于简历的问题…'
            }
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={imageIntake.onPaste}
            onCompositionStart={() => {
              composing.current = true
            }}
            onCompositionEnd={() => {
              composing.current = false
            }}
          />
        </div>
        <div className="composer-toolbar">
          <div className="composer-toolbar-leading">
            <button
              type="button"
              className="composer-attachment-trigger"
              aria-label="添加图片"
              disabled={busy}
              onClick={imageIntake.openPicker}
            >
              <FeatureIcon name="image" size={15} />
            </button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept={IMAGE_INPUT_ACCEPT}
              multiple
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                event.target.value = ''
                if (files.length > 0) void attachFiles(files)
              }}
            />
            <ModelPicker />
            {missingModel ? (
              <button
                type="button"
                className="composer-setup-hint"
                onClick={() => openSettings('model')}
              >
                配置模型服务
              </button>
            ) : null}
          </div>
          <div className="composer-toolbar-trailing">
            <span className="composer-hint" id="composer-hint">
              Enter 发送 · Shift + Enter 换行
            </span>
            {busy ? (
              <Button
                variant="secondary"
                size="small"
                className="composer-stop"
                disabled={runStatus === 'cancelling'}
                onClick={() => {
                  void cancel()
                }}
              >
                <FeatureIcon name="stop" size={13} />
                {runStatus === 'cancelling' ? '停止中…' : '停止'}
              </Button>
            ) : (
              <button
                type="button"
                className="composer-send"
                aria-label="发送消息"
                disabled={!canSend}
                onClick={() => {
                  void send()
                }}
              >
                <FeatureIcon name="send" size={16} />
              </button>
            )}
          </div>
        </div>
        {imageIntake.dragging ? (
          <div className="composer-drop-hint" role="presentation">
            松开以添加图片
          </div>
        ) : null}
      </div>
    </div>
  )
}
