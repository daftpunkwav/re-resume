/**
 * @file messageGroups
 * @description Turns the flat stored transcript into the blocks the transcript
 * view renders: one block per user turn with the tool cards that ran for it and
 * the assistant answer.
 *
 * Why grouping exists: the model stores the assistant's whole answer in one
 * message and every tool card as a later message, so drawing the sequence
 * verbatim would put the answer above the process that produced it. The block
 * renders the process first and the answer after it, without reordering data.
 *
 * Constraints:
 * - Pure and order-preserving inside a block: tools keep their sequence, and the
 *   user and assistant messages keep their identities.
 * - A transcript that does not start with a user turn still groups: the leading
 *   assistant or tool messages form an anonymous block.
 */

import type { Message } from '../../../domain/conversation/Message'
import type { MessageId } from '../../../domain/shared/branded-id'

export interface MessageGroup {
  readonly key: string
  readonly user: Message | null
  readonly tools: readonly Message[]
  readonly assistant: Message | null
}

export function groupMessages(messages: readonly Message[]): readonly MessageGroup[] {
  const groups: { key: string; user: Message | null; tools: Message[]; assistant: Message | null }[] =
    []
  let current: (typeof groups)[number] | null = null
  for (const message of messages) {
    if (message.kind === 'user') {
      current = { key: message.id, user: message, tools: [], assistant: null }
      groups.push(current)
      continue
    }
    if (current === null) {
      current = { key: message.id, user: null, tools: [], assistant: null }
      groups.push(current)
    }
    if (message.kind === 'tool') {
      current.tools.push(message)
      continue
    }
    if (current.assistant === null) {
      current.assistant = message
      continue
    }
    // Two answers without a user turn between them belong to different blocks.
    current = { key: message.id, user: null, tools: [], assistant: message }
    groups.push(current)
  }
  return groups
}

/** The assistant answer that can still be retried: the last one, failed or cancelled. */
export function retryableAssistantId(messages: readonly Message[]): MessageId | null {
  const last = [...messages].reverse().find((message) => message.kind === 'assistant')
  if (last === undefined) return null
  return last.status === 'failed' || last.status === 'cancelled' ? last.id : null
}
