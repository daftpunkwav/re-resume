/**
 * @file MessageRepository
 * @description Persistence port for conversation messages and the lifecycle of
 * the agent run that answers them.
 *
 * Constraints:
 * - `listByConversation` returns the most recent `limit` messages in ascending
 *   sequence order: a transcript view and the context assembler both read the
 *   tail of the conversation, never the whole history.
 * - `createRun` is the per-conversation concurrency gate. When the conversation
 *   already has a running run it returns that run instead of inserting a second
 *   one, so a double send starts a single stream. The partial unique index on
 *   `agent_run` is the database backstop for the same rule.
 */

import type { AgentRun } from '../../generation/AgentRun'
import type { Message } from '../Message'
import type { ConversationId, MessageId } from '../../shared/branded-id'

export interface MessageRepository {
  /** Up to `limit` most recent messages, oldest first. */
  listByConversation(id: ConversationId, limit: number): Promise<readonly Message[]>
  findBySeq(id: ConversationId, seq: number): Promise<Message | null>
  findById(id: MessageId): Promise<Message | null>
  nextSeq(id: ConversationId): Promise<number>
  insert(message: Message): Promise<void>
  update(message: Message): Promise<void>
  /** Deletes every message of the conversation with a sequence after `seq`. */
  deleteAfter(id: ConversationId, seq: number): Promise<void>
  /** Inserts the run, or returns the run already running for this conversation. */
  createRun(run: AgentRun): Promise<AgentRun>
}
