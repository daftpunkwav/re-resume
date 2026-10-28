/**
 * @file ConversationView
 * @description The conversation region as the shell mounts it: wires the stores
 * to the composition root, restores or opens a session, and lays out the
 * transcript, the empty state, the run notice and the composer.
 *
 * Responsibilities:
 * - Connect the conversation and provider stores for the root currently serving
 * - React to "new conversation" from the shell (sidebar button, Ctrl/Cmd+N)
 * - Show the failure notice with its retry entry, and announce run status
 * - Move the reader to the composer when a new draft starts
 *
 * Constraints:
 * - No repository or provider is named here: everything arrives through the
 *   capability facade.
 * - The transcript is keyed by conversation so its scroll position belongs to one
 *   session at a time.
 */

import { useEffect, useRef } from 'react'
import { useServices } from '../../app/ApplicationServicesProvider'
import { Button } from '../../app/components/Button'
import { Notice } from '../../app/components/Notice'
import { useShellStore } from '../../app/stores/shellStore'
import { Composer } from './Composer'
import { EmptyConversation } from './EmptyConversation'
import { MessageList } from './MessageList'
import { retryableAssistantId } from './messageGroups'
import { storesForRoot } from './stores/connect'
import { useConversationStore } from './stores/conversationStore'
import { useProviderStore } from './stores/providerStore'
import { useRunStore } from './stores/runStore'
import './conversation.css'

export function ConversationView() {
  const services = useServices()
  const activeId = useConversationStore((state) => state.activeId)
  const messages = useConversationStore((state) => state.messages)
  const error = useConversationStore((state) => state.error)
  const clearError = useConversationStore((state) => state.clearError)
  const retry = useConversationStore((state) => state.retry)
  const composerFocusRequest = useConversationStore((state) => state.composerFocusRequest)
  const draftEpoch = useShellStore((state) => state.draftEpoch)
  const runStatus = useRunStore((state) => state.status)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const initialEpoch = useRef(draftEpoch)

  useEffect(() => {
    const stores = storesForRoot(services)
    useConversationStore.getState().connect(stores.conversation)
    useProviderStore.getState().connect(stores.providers)
  }, [services])

  // "New conversation" arrives from the sidebar button and the shortcut through
  // the shell store; this is the one place that turns it into a draft.
  useEffect(() => {
    if (draftEpoch === initialEpoch.current) return
    useConversationStore.getState().startDraft()
    const timer = window.setTimeout(() => composerInput.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [draftEpoch])

  // A chip attached from a panel is meant to be sent next; the keyboard goes
  // with it instead of staying on the panel control.
  useEffect(() => {
    if (composerFocusRequest === 0) return
    composerInput.current?.focus()
  }, [composerFocusRequest])

  // The streamed text is not a live region; the status node announces the run
  // state once per transition instead.
  const announcement =
    runStatus === 'running'
      ? '助手正在生成回答'
      : runStatus === 'cancelling'
        ? '正在停止生成'
        : ''
  const retryableId = retryableAssistantId(messages)
  const showEmpty = activeId === null

  return (
    <div className="conversation-view">
      <div className="conversation-stage">
        {showEmpty ? (
          <div className="conversation-scroll">
            <EmptyConversation />
          </div>
        ) : (
          <MessageList key={activeId} />
        )}
      </div>

      <div className="composer-region">
        {error === null ? null : (
          <div className="composer-notice">
            <Notice
              tone="danger"
              title="这次操作没有完成"
              actions={
                <>
                  {retryableId === null || runStatus !== 'idle' ? null : (
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => {
                        void retry(retryableId)
                      }}
                    >
                      重试
                    </Button>
                  )}
                  <Button size="small" variant="ghost" onClick={clearError}>
                    关闭
                  </Button>
                </>
              }
            >
              <p>{error.message}</p>
            </Notice>
          </div>
        )}
        <Composer inputRef={composerInput} />
      </div>

      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  )
}
