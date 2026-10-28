/**
 * @file ConversationList
 * @description The stored sessions in the sidebar: pinned first, then today,
 * the last seven days and everything older. A row opens its session, and its
 * hover actions rename it inline, pin it, or delete it after a confirmation.
 *
 * Constraints:
 * - The list is display plus three list operations; the store performs the write
 *   and reloads the ordering.
 * - A rename is committed on Enter or blur; Escape restores the stored title.
 * - Deleting the open session moves the workspace to the next one, or to a new
 *   draft when none is left.
 */

import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../../app/components/Dialog'
import { Icon } from '../../app/components/Icon'
import { IconButton } from '../../app/components/IconButton'
import { useShellStore } from '../../app/stores/shellStore'
import type { Conversation } from '../../../domain/conversation/Conversation'
import { useConversationStore } from './stores/conversationStore'
import { formatRelativeTime } from './time'
import { FeatureIcon } from './icons'
import type { ConversationGroups } from '../../../application/conversation/listConversations'

interface GroupSection {
  readonly key: string
  readonly title: string
  readonly conversations: readonly Conversation[]
}

/** Pinned sessions get their own heading; the rest keep the date grouping. */
export function groupSections(
  conversations: readonly Conversation[],
  groups: ConversationGroups,
): readonly GroupSection[] {
  const pinned = conversations.filter((conversation) => conversation.pinned)
  const sections: GroupSection[] = []
  if (pinned.length > 0) sections.push({ key: 'pinned', title: '置顶', conversations: pinned })
  const dated: readonly { key: string; title: string; source: readonly Conversation[] }[] = [
    { key: 'today', title: '今天', source: groups.today },
    { key: 'last7Days', title: '近 7 天', source: groups.last7Days },
    { key: 'earlier', title: '更早', source: groups.earlier },
  ]
  for (const group of dated) {
    const unpinned = group.source.filter((conversation) => !conversation.pinned)
    if (unpinned.length > 0) {
      sections.push({ key: group.key, title: group.title, conversations: unpinned })
    }
  }
  return sections
}

export interface ConversationListProps {
  readonly collapsed: boolean
}

export function ConversationList({ collapsed }: ConversationListProps) {
  const conversations = useConversationStore((state) => state.conversations)
  const groups = useConversationStore((state) => state.groups)
  const activeId = useConversationStore((state) => state.activeId)
  const listStatus = useConversationStore((state) => state.listStatus)
  const openConversation = useConversationStore((state) => state.openConversation)
  const loadConversations = useConversationStore((state) => state.loadConversations)
  const startNewConversation = useShellStore((state) => state.startNewConversation)
  const [deleting, setDeleting] = useState<Conversation | null>(null)

  if (collapsed) return null

  const sections = groups === null ? [] : groupSections(conversations, groups)

  return (
    <div className="conversation-list-region">
      {listStatus === 'loading' && conversations.length === 0 ? (
        <div className="conversation-list-skeleton" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span className="conversation-skeleton-row" key={index} />
          ))}
        </div>
      ) : null}

      {listStatus === 'failed' ? (
        <div className="sidebar-empty">
          <Icon name="alert" size={16} />
          <span className="sidebar-empty-copy">
            <span className="sidebar-empty-title">对话列表读取失败</span>
            <button
              type="button"
              className="sidebar-empty-action"
              onClick={() => {
                void loadConversations()
              }}
            >
              重试
            </button>
          </span>
        </div>
      ) : null}

      {listStatus === 'ready' && sections.length === 0 ? (
        <div className="sidebar-empty">
          <Icon name="message-square" size={16} />
          <span className="sidebar-empty-copy">
            <span className="sidebar-empty-title">还没有对话</span>
            <span className="sidebar-empty-hint">对话记录保存在本机。</span>
            <button
              type="button"
              className="sidebar-empty-action"
              onClick={() => {
                startNewConversation()
                const region = document.querySelector<HTMLElement>('[data-region="conversation"]')
                region?.focus()
              }}
            >
              开始第一个对话
            </button>
          </span>
        </div>
      ) : null}

      {sections.map((section) => (
        <section className="conversation-group" key={section.key} aria-label={section.title}>
          <p className="conversation-group-title">{section.title}</p>
          <ul className="conversation-group-list">
            {section.conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                onOpen={() => {
                  void openConversation(conversation.id)
                  document.querySelector<HTMLElement>('[data-region="conversation"]')?.focus()
                }}
                onDelete={() => setDeleting(conversation)}
              />
            ))}
          </ul>
        </section>
      ))}

      <Dialog
        open={deleting !== null}
        title="删除这段对话？"
        description="对话与其中的消息会从本机删除，无法恢复。"
        confirmLabel="删除"
        destructive
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting
          setDeleting(null)
          if (target === null) return
          void useConversationStore.getState().removeConversation(target.id)
        }}
      >
        <p className="dialog-note">{deleting?.title}</p>
      </Dialog>
    </div>
  )
}

interface ConversationRowProps {
  readonly conversation: Conversation
  readonly active: boolean
  readonly onOpen: () => void
  readonly onDelete: () => void
}

function ConversationRow({ conversation, active, onOpen, onDelete }: ConversationRowProps) {
  const renameConversation = useConversationStore((state) => state.renameConversation)
  const togglePinned = useConversationStore((state) => state.togglePinned)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conversation.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const beginRename = (): void => {
    setDraft(conversation.title)
    setEditing(true)
  }

  const commit = (): void => {
    if (!editing) return
    setEditing(false)
    const next = draft.trim()
    if (next === '' || next === conversation.title) return
    void renameConversation(conversation.id, next)
  }

  return (
    <li
      className={[
        'conversation-row',
        active ? 'conversation-row-active' : '',
        editing ? 'conversation-row-renaming' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="conversation-rename-input"
          value={draft}
          aria-label="会话标题"
          maxLength={60}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(conversation.title)
              setEditing(false)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="conversation-row-open"
          aria-current={active ? 'true' : undefined}
          onClick={onOpen}
          title={conversation.title}
        >
          {conversation.pinned ? (
            <span className="conversation-pin-mark" aria-label="已置顶">
              <FeatureIcon name="pin" size={11} />
            </span>
          ) : null}
          <span className="conversation-row-title">{conversation.title}</span>
          <span className="conversation-row-time">
            {formatRelativeTime(conversation.updatedAt)}
          </span>
        </button>
      )}
      <span className="conversation-row-actions">
        <button
          type="button"
          className="conversation-row-action"
          aria-label={conversation.pinned ? '取消置顶对话' : '置顶对话'}
          aria-pressed={conversation.pinned}
          title={conversation.pinned ? '取消置顶' : '置顶'}
          onClick={() => {
            void togglePinned(conversation.id, !conversation.pinned)
          }}
        >
          <FeatureIcon name={conversation.pinned ? 'pin-off' : 'pin'} size={13} />
        </button>
        <IconButton
          icon="pen"
          label="重命名对话"
          size="small"
          showTooltip={false}
          onClick={beginRename}
        />
        <IconButton
          icon="close"
          label="删除对话"
          size="small"
          showTooltip={false}
          onClick={onDelete}
        />
      </span>
    </li>
  )
}
