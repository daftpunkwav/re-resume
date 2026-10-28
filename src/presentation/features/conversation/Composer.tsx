/**
 * @file Composer
 * @description The input region: a growing textarea, the context chips of the
 * turn, the model control and the send/stop button.
 *
 * Responsibilities:
 * - Enter sends, Shift+Enter inserts a line break, and an IME composition owns
 *   every key it sees
 * - Swap the send button for a stop button while an answer streams
 * - Keep the draft when the send fails; the store restores it
 * - Show the setup entry when no model service is configured
 *
 * Constraints:
 * - The draft lives in the conversation store, so an unrelated re-render never
 *   loses it.
 * - A disabled send button and the store's own run gate are two independent
 *   guards against a double send.
 */

import { useRef } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { Button } from '../../app/components/Button'
import { useShellStore } from '../../app/stores/shellStore'
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
  const setComposerText = useConversationStore((state) => state.setComposerText)
  const removeContext = useConversationStore((state) => state.removeContext)
  const send = useConversationStore((state) => state.send)
  const cancel = useConversationStore((state) => state.cancel)
  const runStatus = useRunStore((state) => state.status)
  const providerStatus = useProviderStore((state) => state.status)
  const providers = useProviderStore((state) => state.providers)
  const openSettings = useShellStore((state) => state.openSettings)
  const composing = useRef(false)

  useAutoResize(inputRef, text)

  const busy = runStatus !== 'idle'
  const canSend = text.trim() !== '' && !busy
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
    <div className="composer-dock">
      <div className="composer" data-busy={busy || undefined}>
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
                : '描述目标岗位，或直接问助手任何关于简历的问题…'
            }
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={onKeyDown}
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
      </div>
    </div>
  )
}
