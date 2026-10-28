/**
 * @file MessageItem
 * @description One rendered turn: the user bubble with its context chips, the
 * assistant answer (Markdown, streaming or settled), and the tool card rows that
 * belong to the same turn.
 *
 * Constraints:
 * - A settled answer is memoised: a text delta must re-render only the streaming
 *   bubble, never the transcript that came before it.
 * - The user's text is shown verbatim; it is never rendered as Markdown, so a
 *   message that looks like a table cannot turn into one.
 */

import { memo } from 'react'
import { Tooltip } from '../../app/components/Tooltip'
import { showToast } from '../../app/stores/toastStore'
import type { Message } from '../../../domain/conversation/Message'
import type { MessageContext } from '../../../domain/conversation/MessageContext'
import { copyToClipboard } from './clipboard'
import { ContextChip } from './ContextChip'
import { labelForContext } from './stores/conversationStore'
import type { TokenUsage } from './stores/runStore'
import { FeatureIcon } from './icons'
import { Markdown } from './Markdown'
import { useStreamingText } from './hooks'

export interface MessageItemProps {
  readonly message: Message
  /** Chips the user attached to this turn; only user messages carry them. */
  readonly contexts?: readonly MessageContext[]
  readonly contextEntries: Readonly<Record<string, string>>
  readonly usage?: TokenUsage
  /** True for a message the last reload appended; plays the 120 ms entrance. */
  readonly enter: boolean
  readonly streaming: boolean
  readonly canRetry: boolean
  readonly onRetry: (messageId: Message['id']) => void
}

async function copyMessage(markdown: string): Promise<void> {
  const copied = await copyToClipboard(markdown)
  showToast(
    copied ? 'success' : 'danger',
    copied ? '已复制这条消息' : '复制失败，请手动选择文本',
  )
}

function StreamingAnswer() {
  const text = useStreamingText()
  return (
    <div className="message-answer message-answer-streaming">
      {text === '' ? (
        <span className="stream-placeholder">正在生成…</span>
      ) : (
        <>
          <Markdown markdown={text} />
          <span className="stream-cursor" aria-hidden="true" />
        </>
      )}
    </div>
  )
}

function AssistantMessage({
  message,
  usage,
  streaming,
  canRetry,
  enter,
  onRetry,
}: MessageItemProps) {
  const failed = message.status === 'failed'
  const cancelled = message.status === 'cancelled'
  return (
    <div
      className={[
        'message',
        'message-assistant',
        enter ? 'message-enter' : '',
        failed ? 'message-failed' : '',
        cancelled ? 'message-cancelled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-message-id={message.id}
    >
      <div className="message-role" aria-hidden="true">
        <span className="message-avatar">R</span>
      </div>
      <div className="message-main">
        {streaming ? (
          <StreamingAnswer />
        ) : message.markdown === '' ? null : (
          <div className="message-answer">
            <Markdown markdown={message.markdown} />
          </div>
        )}
        {streaming ? (
          <p className="message-status">
            <span className="message-status-dot" aria-hidden="true" />
            正在生成回答
          </p>
        ) : null}
        {failed || cancelled ? (
          <div className="message-status message-status-bad" role="status">
            <FeatureIcon name="alert-circle" size={14} />
            <span>{failed ? '生成失败' : '已取消'}</span>
            {message.errorText === null ? null : (
              <span className="message-status-detail">{message.errorText}</span>
            )}
            {canRetry ? (
              <button
                type="button"
                className="message-inline-action"
                onClick={() => onRetry(message.id)}
              >
                <FeatureIcon name="refresh" size={13} />
                重试
              </button>
            ) : null}
          </div>
        ) : null}
        {streaming ? null : (
          <div className="message-meta">
            <span className="message-meta-text">
              {usage === undefined ? '' : `${formatTokenTotal(usage)} token`}
            </span>
            <span className="message-actions">
              {message.markdown === '' ? null : (
                <Tooltip label="复制" placement="top">
                  <button
                    type="button"
                    className="message-action"
                    aria-label="复制这条消息"
                    onClick={() => {
                      void copyMessage(message.markdown)
                    }}
                  >
                    <FeatureIcon name="copy" size={14} />
                  </button>
                </Tooltip>
              )}
              {canRetry && (failed || cancelled) ? (
                <Tooltip label="重新生成" placement="top">
                  <button
                    type="button"
                    className="message-action"
                    aria-label="重新生成这条回答"
                    onClick={() => onRetry(message.id)}
                  >
                    <FeatureIcon name="refresh" size={14} />
                  </button>
                </Tooltip>
              ) : null}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function formatTokenTotal(usage: TokenUsage): string {
  return (usage.promptTokens + usage.completionTokens).toLocaleString('zh-CN')
}

export interface UserBubbleProps {
  readonly text: string
  readonly contexts: readonly MessageContext[]
  readonly contextEntries: Readonly<Record<string, string>>
  readonly enter: boolean
  readonly messageId?: string
  readonly pending?: boolean
}

/** The user bubble, shared by a stored turn and by the optimistic pending turn. */
export function UserBubble({
  text,
  contexts,
  contextEntries,
  enter,
  messageId,
  pending = false,
}: UserBubbleProps) {
  return (
    <div
      className={[
        'message',
        'message-user',
        enter ? 'message-enter' : '',
        pending ? 'message-pending' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-message-id={messageId}
    >
      <div className="message-user-body">
        <p className="message-user-text">{text}</p>
        {contexts.length === 0 ? null : (
          <div className="message-contexts">
            {contexts.map((context) => (
              <ContextChip
                key={`${context.kind}:${context.refId}`}
                kind={context.kind}
                label={labelForContext(context, contextEntries)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function UserMessage({ message, contexts, contextEntries, enter }: MessageItemProps) {
  return (
    <UserBubble
      text={message.markdown}
      contexts={contexts ?? []}
      contextEntries={contextEntries}
      enter={enter}
      messageId={message.id}
    />
  )
}

export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { message } = props
  if (message.kind === 'user') return <UserMessage {...props} />
  if (message.kind === 'assistant') return <AssistantMessage {...props} />
  return null
})
