/**
 * @file togglePinned
 * @description Sets the pinned flag of a conversation. The sidebar reads pinned
 * first, then the last update, so this one write is all the ordering depends on.
 */

import type { Conversation } from '../../domain/conversation/Conversation'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { Clock } from '../../domain/shared/Clock'
import type { ConversationId } from '../../domain/shared/branded-id'
import { findConversation } from './renameConversation'

export interface TogglePinnedDeps {
  readonly conversations: ConversationRepository
  readonly clock: Clock
}

export interface TogglePinnedInput {
  readonly conversationId: ConversationId
  readonly pinned: boolean
}

export async function togglePinned(
  deps: TogglePinnedDeps,
  input: TogglePinnedInput,
): Promise<Conversation> {
  const conversation = await findConversation(deps, input.conversationId)
  if (conversation.pinned === input.pinned) return conversation
  const updated: Conversation = {
    ...conversation,
    pinned: input.pinned,
    updatedAt: deps.clock.now(),
  }
  await deps.conversations.update(updated)
  return updated
}
