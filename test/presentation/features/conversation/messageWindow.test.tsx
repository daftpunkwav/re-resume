/**
 * @file messageWindow.test
 * @description The transcript stays bounded: a conversation the store holds with
 * 2000 messages mounts only the newest window, older turns are revealed on
 * request, and the block the window starts at is asserted, not just its size.
 * The bound is observed through the mounted block count; a wall-clock budget
 * would measure the machine and the other test files sharing it rather than the
 * windowing rule.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  INITIAL_VISIBLE_GROUPS,
  LOAD_OLDER_GROUPS,
  MessageList,
} from '../../../../src/presentation/features/conversation/MessageList'
import { groupMessages } from '../../../../src/presentation/features/conversation/messageGroups'
import { useConversationStore } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import type { Message } from '../../../../src/domain/conversation/Message'
import type { ConversationId, MessageId } from '../../../../src/domain/shared/branded-id'

const CONVERSATION_ID = 'conversation-window' as ConversationId
const EPOCH = '2026-01-01T00:00:00.000Z' as Message['createdAt']

function message(id: string, seq: number, kind: 'user' | 'assistant'): Message {
  return {
    id: id as MessageId,
    conversationId: CONVERSATION_ID,
    seq,
    kind,
    status: 'complete',
    markdown: kind === 'user' ? `问题 ${seq.toString()}` : `回答 ${seq.toString()}`,
    attachmentIds: [],
    tool: null,
    runId: null,
    errorText: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  }
}

/** 2000 messages: 1000 user turns, each answered once. */
function longConversation(): readonly Message[] {
  const messages: Message[] = []
  for (let turn = 0; turn < 1000; turn += 1) {
    messages.push(message(`user-${turn.toString()}`, turn * 2 + 1, 'user'))
    messages.push(message(`assistant-${turn.toString()}`, turn * 2 + 2, 'assistant'))
  }
  return messages
}

afterEach(() => {
  useConversationStore.getState().connect(null)
})

describe('the transcript window', () => {
  it('groups 2000 messages into one block per turn', () => {
    const groups = groupMessages(longConversation())
    expect(groups).toHaveLength(1000)
    expect(groups[0]).toMatchObject({ user: { seq: 1 }, assistant: { seq: 2 } })
    expect(groups[999]).toMatchObject({ user: { seq: 1999 }, assistant: { seq: 2000 } })
  })

  it('mounts only the newest window and reveals older turns on request', () => {
    useConversationStore.setState({
      activeId: CONVERSATION_ID,
      draft: false,
      messages: longConversation(),
      messagesStatus: 'ready',
    })

    render(<MessageList />)

    expect(screen.getAllByRole('region', { name: '一轮对话' })).toHaveLength(INITIAL_VISIBLE_GROUPS)
    // The window is the newest one: with 1000 groups, the first 920 are stored
    // but not mounted, and mounting any 80 of them would not satisfy this.
    expect(screen.getByText('问题 1841')).toBeInTheDocument()
    expect(screen.queryByText('问题 1839')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /显示更早的/ }))
    expect(screen.getAllByRole('region', { name: '一轮对话' })).toHaveLength(
      INITIAL_VISIBLE_GROUPS + LOAD_OLDER_GROUPS,
    )
    // Revealing adds the next older page and leaves the newest block mounted.
    expect(screen.getByText('问题 1681')).toBeInTheDocument()
    expect(screen.queryByText('问题 1679')).toBeNull()
    expect(screen.getByText('问题 1999')).toBeInTheDocument()
  })
})
