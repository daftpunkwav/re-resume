/**
 * @file listConversations
 * @description Lists conversations for the sidebar: pinned first, then most
 * recently updated, with the three groups the interface renders under headings.
 */

import {
  CONVERSATION_GROUPS,
  conversationGroupFor,
} from '../../domain/conversation/Conversation'
import type { Conversation, ConversationGroup } from '../../domain/conversation/Conversation'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { Clock } from '../../domain/shared/Clock'

export interface ListConversationsDeps {
  readonly conversations: ConversationRepository
  readonly clock: Clock
}

export interface ConversationGroups {
  readonly today: readonly Conversation[]
  readonly last7Days: readonly Conversation[]
  readonly earlier: readonly Conversation[]
}

export interface ListConversationsOutput {
  readonly conversations: readonly Conversation[]
  readonly groups: ConversationGroups
}

export async function listConversations(
  deps: ListConversationsDeps,
): Promise<ListConversationsOutput> {
  const now = deps.clock.now()
  const conversations = [...(await deps.conversations.listAll())].sort(compareConversations)
  const groups: Record<ConversationGroup, Conversation[]> = {
    today: [],
    last7Days: [],
    earlier: [],
  }
  for (const conversation of conversations) {
    groups[conversationGroupFor(conversation.updatedAt, now)].push(conversation)
  }
  return {
    conversations,
    groups: {
      today: groups.today,
      last7Days: groups.last7Days,
      earlier: groups.earlier,
    },
  }
}

/** Pinned first, then newest update, then identifier for a stable order. */
function compareConversations(left: Conversation, right: Conversation): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1
  return left.id.localeCompare(right.id)
}

/** Re-exported so the interface can iterate the heading order without importing the domain constant twice. */
export { CONVERSATION_GROUPS }
