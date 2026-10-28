/**
 * @file TopBar
 * @description The header of the conversation region: the session title with
 * inline rename, the model-service control, the delete entry and the two
 * switches for the right-hand panels.
 *
 * Constraints:
 * - The title belongs to the stored session; a draft shows the default title
 *   until the first message creates the row.
 * - Rename commits on Enter or blur and restores the stored title on Escape.
 */

import { useEffect, useRef, useState } from 'react'
import { Dialog } from './components/Dialog'
import { IconButton } from './components/IconButton'
import { Tooltip } from './components/Tooltip'
import { useConversationStore } from '../features/conversation/stores/conversationStore'
import { useRunStore } from '../features/conversation/stores/runStore'
import { ModelPicker } from '../features/conversation/ModelPicker'
import { FeatureIcon } from '../features/conversation/icons'
import { formatRelativeTime } from '../features/conversation/time'
import { useShellStore } from './stores/shellStore'

export interface TopBarProps {
  /** True when the sidebar is showing as icons only. */
  readonly collapsed: boolean
}

export function TopBar({ collapsed }: TopBarProps) {
  const rightPanel = useShellStore((state) => state.rightPanel)
  const togglePanel = useShellStore((state) => state.togglePanel)
  const toggleSidebar = useShellStore((state) => state.toggleSidebar)
  const conversations = useConversationStore((state) => state.conversations)
  const activeId = useConversationStore((state) => state.activeId)
  const draft = useConversationStore((state) => state.draft)
  const renameConversation = useConversationStore((state) => state.renameConversation)
  const removeConversation = useConversationStore((state) => state.removeConversation)
  const runStatus = useRunStore((state) => state.status)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const titleInput = useRef<HTMLInputElement>(null)

  const conversation = conversations.find((entry) => entry.id === activeId) ?? null
  const title = conversation?.title ?? '新对话'
  const note =
    runStatus !== 'idle'
      ? '正在生成'
      : conversation === null || draft
        ? '尚未开始'
        : formatRelativeTime(conversation.updatedAt)

  const infoVisible = rightPanel === 'info' || rightPanel === 'both'
  const resumeVisible = rightPanel === 'resume' || rightPanel === 'both'

  useEffect(() => {
    if (!editing) return
    titleInput.current?.focus()
    titleInput.current?.select()
  }, [editing])

  const beginRename = (): void => {
    if (conversation === null) return
    setDraftTitle(conversation.title)
    setEditing(true)
  }

  const commitRename = (): void => {
    if (!editing) return
    setEditing(false)
    const next = draftTitle.trim()
    if (conversation === null || next === '' || next === conversation.title) return
    void renameConversation(conversation.id, next)
  }

  return (
    <header className="topbar">
      <div className="topbar-leading">
        {collapsed ? (
          <IconButton icon="panel-left" label="展开侧边栏" size="small" onClick={toggleSidebar} />
        ) : null}
        {editing ? (
          <input
            ref={titleInput}
            className="topbar-title-input"
            aria-label="会话标题"
            value={draftTitle}
            maxLength={60}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitRename()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDraftTitle(title)
                setEditing(false)
              }
            }}
          />
        ) : (
          <h1 className="topbar-title">
            {conversation === null ? (
              title
            ) : (
              <button
                type="button"
                className="topbar-title-button"
                title="点击重命名会话"
                onClick={beginRename}
              >
                {title}
              </button>
            )}
          </h1>
        )}
        <span className="topbar-note">{note}</span>
      </div>
      <div className="topbar-actions">
        <ModelPicker />
        <span className="topbar-divider" aria-hidden="true" />
        <IconButton
          icon="id-card"
          label="简历信息面板"
          pressed={infoVisible}
          onClick={() => togglePanel('info')}
        />
        <IconButton
          icon="pen"
          label="简历创作面板"
          pressed={resumeVisible}
          onClick={() => togglePanel('resume')}
        />
        {conversation === null ? null : (
          <Tooltip label={runStatus === 'idle' ? '删除对话' : '停止生成后才能删除'} placement="bottom">
            <button
              type="button"
              className="topbar-delete"
              aria-label="删除当前对话"
              disabled={runStatus !== 'idle'}
              onClick={() => setConfirmingDelete(true)}
            >
              <FeatureIcon name="trash" size={15} />
            </button>
          </Tooltip>
        )}
      </div>

      <Dialog
        open={confirmingDelete}
        title="删除这段对话？"
        description="对话与其中的消息会从本机删除，无法恢复。"
        confirmLabel="删除"
        destructive
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false)
          if (conversation !== null) void removeConversation(conversation.id)
        }}
      >
        <p className="dialog-note">{conversation?.title}</p>
      </Dialog>
    </header>
  )
}
