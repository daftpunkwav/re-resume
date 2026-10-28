/**
 * @file MessageContextRepository
 * @description Persistence port for the context chips attached to a message.
 * The chips are reference rows, not copies of the referenced content.
 */

import type { MessageContext } from '../MessageContext'
import type { MessageId } from '../../shared/branded-id'

export interface MessageContextRepository {
  listByMessage(id: MessageId): Promise<readonly MessageContext[]>
  insertAll(contexts: readonly { readonly messageId: MessageId; readonly context: MessageContext }[]): Promise<void>
}
