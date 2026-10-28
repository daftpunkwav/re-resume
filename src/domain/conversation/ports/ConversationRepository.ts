/**
 * @file ConversationRepository
 * @description Persistence port for conversation rows. The list the sidebar
 * renders, the pin flag and the rolling summary are all stored here.
 */

import type { Conversation } from '../Conversation'
import type { ConversationId } from '../../shared/branded-id'

export interface ConversationRepository {
  findById(id: ConversationId): Promise<Conversation | null>
  listAll(): Promise<readonly Conversation[]>
  insert(conversation: Conversation): Promise<void>
  update(conversation: Conversation): Promise<void>
  delete(id: ConversationId): Promise<void>
}
