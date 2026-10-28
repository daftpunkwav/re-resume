/**
 * @file renameConversation
 * @description Renames a conversation. Metadata changes are written directly:
 * a conversation is not part of the resume revision chain.
 */

import { normaliseConversationTitle } from '../../domain/conversation/Conversation'
import type { Conversation } from '../../domain/conversation/Conversation'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import { DomainError } from '../../domain/shared/DomainError'
import type { Clock } from '../../domain/shared/Clock'
import type { ConversationId } from '../../domain/shared/branded-id'

export interface RenameConversationDeps {
  readonly conversations: ConversationRepository
  readonly clock: Clock
}

export interface RenameConversationInput {
  readonly conversationId: ConversationId
  readonly title: string
}

export async function renameConversation(
  deps: RenameConversationDeps,
  input: RenameConversationInput,
): Promise<Conversation> {
  const conversation = await findConversation(deps, input.conversationId)
  const renamed: Conversation = {
    ...conversation,
    title: normaliseConversationTitle(input.title),
    updatedAt: deps.clock.now(),
  }
  await deps.conversations.update(renamed)
  return renamed
}

export async function findConversation(
  deps: { readonly conversations: ConversationRepository },
  conversationId: ConversationId,
): Promise<Conversation> {
  const conversation = await deps.conversations.findById(conversationId)
  if (conversation === null) {
    throw new DomainError('conversationNotFound', '会话不存在或已被删除。', {
      entity: 'conversation',
      id: conversationId,
      blockers: [],
    })
  }
  return conversation
}
