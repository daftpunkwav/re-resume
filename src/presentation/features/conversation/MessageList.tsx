/**
 * @file MessageList
 * @description The transcript: grouped turns, live streaming, the optimistic
 * user turn, the loading skeleton, and the scroll behaviour that keeps the
 * newest message in view without fighting a reader who scrolled up.
 *
 * Constraints:
 * - Settled messages are memoised; only the streaming bubble re-renders per
 *   frame.
 * - The transcript follows the bottom only while the reader is already there;
 *   the jump button is the way back.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { IconButton } from '../../app/components/IconButton'
import type { Message } from '../../../domain/conversation/Message'
import { FeatureIcon } from './icons'
import { MessageItem, UserBubble } from './MessageItem'
import { groupMessages, retryableAssistantId } from './messageGroups'
import { onStreamPaint, useStickToBottom } from './hooks'
import { useConversationStore } from './stores/conversationStore'
import { useRunStore } from './stores/runStore'
import { ToolCard } from './ToolCard'

const SKELETON_ROWS = 3

export function MessageList() {
  const messages = useConversationStore((state) => state.messages)
  const pendingUser = useConversationStore((state) => state.pendingUser)
  const messagesStatus = useConversationStore((state) => state.messagesStatus)
  const contextsByMessage = useConversationStore((state) => state.contextsByMessage)
  const contextEntries = useConversationStore((state) => state.contextEntries)
  const enterIds = useConversationStore((state) => state.enterIds)
  const activeId = useConversationStore((state) => state.activeId)
  const retry = useConversationStore((state) => state.retry)
  const assistantMessageId = useRunStore((state) => state.assistantMessageId)
  const runStatus = useRunStore((state) => state.status)
  const usageByMessage = useRunStore((state) => state.usageByMessage)

  const groups = useMemo(() => groupMessages(messages), [messages])
  const retryableId = useMemo(() => retryableAssistantId(messages), [messages])
  const contentKey = messages.length + (pendingUser === null ? 0 : 1)
  const { containerRef, atBottom, jumpToBottom } = useStickToBottom(contentKey)

  // Streaming text does not change `messages`; the frame sampler reports here so
  // the transcript follows the growing answer without subscribing to the deltas.
  useEffect(
    () =>
      onStreamPaint(() => {
        const element = containerRef.current
        if (element === null) return
        const distance = element.scrollHeight - element.scrollTop - element.clientHeight
        if (distance < 48) element.scrollTop = element.scrollHeight
      }),
    [containerRef],
  )

  const onRetry = useCallback(
    (messageId: Message['id']) => {
      void retry(messageId)
    },
    [retry],
  )

  if (activeId === null) return null

  const loading = messagesStatus === 'loading' && messages.length === 0
  const blank = !loading && groups.length === 0 && pendingUser === null

  return (
    <div className="transcript-wrap">
      <div
        className="transcript"
        ref={containerRef}
        role="log"
        aria-label="对话消息"
        aria-busy={loading || runStatus !== 'idle' || undefined}
      >
        {loading ? (
          <div className="transcript-skeleton" aria-hidden="true">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <div className="skeleton-row" key={index}>
                <span className="skeleton-avatar" />
                <span className="skeleton-lines">
                  <span className="skeleton-line skeleton-line-long" />
                  <span className="skeleton-line skeleton-line-short" />
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {blank ? (
          <div className="transcript-blank">
            <FeatureIcon name="sparkles" size={20} />
            <p className="transcript-blank-title">这个会话还没有消息</p>
            <p className="transcript-blank-hint">在下方输入内容，开始这一段对话。</p>
          </div>
        ) : null}

        {groups.map((group) => (
          <section className="message-group" key={group.key} aria-label="一轮对话">
            {group.user === null ? null : (
              <MessageItem
                message={group.user}
                contexts={contextsByMessage[group.user.id]}
                contextEntries={contextEntries}
                enter={enterIds.has(group.user.id)}
                streaming={false}
                canRetry={false}
                onRetry={onRetry}
              />
            )}
            {group.tools.length === 0 ? null : (
              <div className="tool-card-list">
                {group.tools.map((tool) => (
                  <ToolCard key={tool.id} message={tool} />
                ))}
              </div>
            )}
            {group.assistant === null ? null : (
              <MessageItem
                message={group.assistant}
                contextEntries={contextEntries}
                usage={usageByMessage[group.assistant.id]}
                enter={enterIds.has(group.assistant.id)}
                streaming={
                  group.assistant.id === assistantMessageId &&
                  runStatus !== 'idle' &&
                  group.assistant.status === 'streaming'
                }
                canRetry={retryableId === group.assistant.id && runStatus === 'idle'}
                onRetry={onRetry}
              />
            )}
          </section>
        ))}

        {pendingUser === null ? null : (
          <UserBubble
            text={pendingUser.text}
            contexts={pendingUser.contexts}
            contextEntries={contextEntries}
            enter={false}
            pending
          />
        )}
      </div>

      {atBottom ? null : (
        <div className="jump-to-bottom">
          <IconButton
            icon="chevron-down"
            label="回到最新消息"
            size="small"
            variant="secondary"
            onClick={jumpToBottom}
          />
        </div>
      )}
    </div>
  )
}
