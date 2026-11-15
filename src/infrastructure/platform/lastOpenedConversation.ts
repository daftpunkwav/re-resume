/**
 * @file lastOpenedConversation
 * @description Browser storage for the conversation the window opened last. The
 * conversation area reads it while restoring a session and writes it on every
 * open, so the next launch lands where the previous one left off.
 *
 * Constraints:
 * - This is window continuity state, not user data: it is not part of the
 *   settings row and never appears in a backup. Losing the entry only changes
 *   which session the window restores.
 * - Both operations are total. Private-mode storage, a cleared entry and
 *   malformed content all read as "no preference"; a failed write is dropped.
 *   Refusing to open the conversation list over this value would trade a
 *   convenience for the whole interface.
 * - The key carries a version so a future shape reads as absent instead of as
 *   garbage.
 */

import { asConversationId } from '../../domain/shared/branded-id'
import type { ConversationId } from '../../domain/shared/branded-id'

/** Versioned key: a future shape change reads as absent rather than as garbage. */
export const LAST_OPENED_CONVERSATION_KEY = 'reresume.conversation.lastOpened.v1'

export class BrowserLastOpenedConversationStore {
  read(): ConversationId | null {
    try {
      const stored = window.localStorage.getItem(LAST_OPENED_CONVERSATION_KEY)
      return stored === null || stored.trim() === '' ? null : asConversationId(stored)
    } catch {
      return null
    }
  }

  write(conversationId: ConversationId): void {
    try {
      window.localStorage.setItem(LAST_OPENED_CONVERSATION_KEY, conversationId)
    } catch {
      // The session keeps working; the choice is just not remembered.
    }
  }
}
