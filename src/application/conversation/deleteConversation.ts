/**
 * @file deleteConversation
 * @description Deletes a conversation. The message rows and their attachment
 * links cascade with it; attachment rows and their bytes stay, because a canvas
 * block or another message may still reference the same file. The agent runs of
 * the conversation stay as audit rows with their conversation reference cleared
 * by the foreign key.
 */

import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { ConversationId } from '../../domain/shared/branded-id'
import { findConversation } from './renameConversation'

export interface DeleteConversationDeps {
  readonly conversations: ConversationRepository
}

export interface DeleteConversationInput {
  readonly conversationId: ConversationId
}

export async function deleteConversation(
  deps: DeleteConversationDeps,
  input: DeleteConversationInput,
): Promise<void> {
  await findConversation(deps, input.conversationId)
  await deps.conversations.delete(input.conversationId)
}
