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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconButton } from '../../app/components/IconButton'
import type { Attachment } from '../../../domain/conversation/Attachment'
import type { Message } from '../../../domain/conversation/Message'
import { FeatureIcon } from './icons'
import { MessageItem, UserBubble } from './MessageItem'
import { groupMessages, retryableAssistantId } from './messageGroups'
import { onStreamPaint, useStickToBottom } from './hooks'
import { useConversationStore } from './stores/conversationStore'
import { useRunStore } from './stores/runStore'
import { ToolCard } from './ToolCard'

const SKELETON_ROWS = 3

/**
 * The window of turns the transcript mounts. The store keeps up to 2000
 * messages per conversation, but only the newest window is in the DOM: the rest
 * stay stored and are revealed a page at a time, so scroll and typing cost stay
 * independent of the stored history.
 */
export const INITIAL_VISIBLE_GROUPS = 80
export const LOAD_OLDER_GROUPS = 80

/** Shared empty list so a message without images keeps a stable memo prop. */
const NO_ATTACHMENTS: readonly Attachment[] = []

export function MessageList() {
  const messages = useConversationStore((state) => state.messages)
  const pendingUser = useConversationStore((state) => state.pendingUser)
  const messagesStatus = useConversationStore((state) => state.messagesStatus)
  const contextsByMessage = useConversationStore((state) => state.contextsByMessage)
  const contextEntries = useConversationStore((state) => state.contextEntries)
  const enterIds = useConversationStore((state) => state.enterIds)
  const activeId = useConversationStore((state) => state.activeId)
  const retry = useConversationStore((state) => state.retry)
  const attachmentsById = useConversationStore((state) => state.attachmentsById)
  const ensureAttachments = useConversationStore((state) => state.ensureAttachments)
  const assistantMessageId = useRunStore((state) => state.assistantMessageId)
  const runStatus = useRunStore((state) => state.status)
  const usageByMessage = useRunStore((state) => state.usageByMessage)

  const groups = useMemo(() => groupMessages(messages), [messages])
  const retryableId = useMemo(() => retryableAssistantId(messages), [messages])
  const contentKey = messages.length + (pendingUser === null ? 0 : 1)
  const { containerRef, atBottom, jumpToBottom, followIfAtBottom } = useStickToBottom(contentKey)
  // Only the newest window of turns is mounted. A conversation may hold up to
  // 2000 messages, and mounting all of them would make scroll and input cost
  // grow with the stored history; older turns are revealed a page at a time.
  const [visibleGroupCount, setVisibleGroupCount] = useState(INITIAL_VISIBLE_GROUPS)
  const hiddenGroupCount = Math.max(0, groups.length - visibleGroupCount)
  const visibleGroups = hiddenGroupCount === 0 ? groups : groups.slice(hiddenGroupCount)

  // An image paints after the message row exists (its bytes are read on mount),
  // which grows the transcript without changing the message count. Watching the
  // rows keeps the reader pinned to the newest answer in that case too.
  useEffect(() => {
    const element = containerRef.current
    if (element === null || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => followIfAtBottom())
    const observed = new WeakSet<Element>()
    const observeAll = (): void => {
      for (const child of element.children) {
        if (observed.has(child)) continue
        observed.add(child)
        observer.observe(child)
      }
    }
    observeAll()
    const mutations = new MutationObserver(observeAll)
    mutations.observe(element, { childList: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [containerRef, followIfAtBottom])

  // The rows of every attachment the transcript names are read once per id;
  // the map below is stable until a row arrives, so memoised messages keep
  // their props.
  const attachmentIds = useMemo(
    () => [...new Set(messages.flatMap((message) => message.attachmentIds))],
    [messages],
  )
  useEffect(() => {
    if (attachmentIds.length > 0) void ensureAttachments(attachmentIds)
  }, [attachmentIds, ensureAttachments])

  const attachmentsByMessage = useMemo(() => {
    const map = new Map<string, readonly Attachment[]>()
    for (const message of messages) {
      if (message.attachmentIds.length === 0) continue
      map.set(
        message.id,
        message.attachmentIds.flatMap((id) => {
          const attachment = attachmentsById[id]
          return attachment === undefined ? [] : [attachment]
        }),
      )
    }
    return map
  }, [messages, attachmentsById])

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

        {hiddenGroupCount === 0 ? null : (
          <div className="transcript-older">
            <button
              type="button"
              className="transcript-older-button"
              onClick={() => setVisibleGroupCount((count) => count + LOAD_OLDER_GROUPS)}
            >
              显示更早的 {Math.min(hiddenGroupCount, LOAD_OLDER_GROUPS).toString()} 条对话
            </button>
          </div>
        )}

        {blank ? (
          <div className="transcript-blank">
            <FeatureIcon name="sparkles" size={20} />
            <p className="transcript-blank-title">这个会话还没有消息</p>
            <p className="transcript-blank-hint">在下方输入内容，开始这一段对话。</p>
          </div>
        ) : null}

        {visibleGroups.map((group) => (
          <section className="message-group" key={group.key} aria-label="一轮对话">
            {group.user === null ? null : (
              <MessageItem
                message={group.user}
                contexts={contextsByMessage[group.user.id]}
                attachments={attachmentsByMessage.get(group.user.id) ?? NO_ATTACHMENTS}
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
            attachments={pendingUser.attachments}
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
