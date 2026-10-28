/**
 * @file retryRun
 * @description Re-runs the assistant answer to an existing user turn. The
 * failed or cancelled answer and the tool cards after it are removed, the
 * original user message is reused, and a new run is created; the old run is
 * kept as history.
 *
 * Responsibilities:
 * - Refuse a message that is not the last assistant answer, or is not in a
 *   retryable state
 * - Remove the answer being retried together with everything after it
 * - Re-run the turn through the normal lifecycle, preserving the chips the user
 *   attached to the original message
 *
 * Constraints:
 * - Only the last assistant message is retryable: retrying an older answer
 *   would silently discard the conversation that came after it.
 * - A conversation with a run still in flight reaches the run gate in
 *   `runAgentTurn`, which returns that run instead of starting a second stream.
 */

import type { MessageContextRepository } from '../../domain/conversation/ports/MessageContextRepository'
import type { Message } from '../../domain/conversation/Message'
import { DomainError } from '../../domain/shared/DomainError'
import type { ConversationId, MessageId } from '../../domain/shared/branded-id'
import type { AgentRun } from '../../domain/generation/AgentRun'
import { runAgentTurn } from './runAgentTurn'
import type { RunAgentTurnDeps, RunAgentTurnInput } from './runAgentTurn'

export interface RetryRunInput {
  readonly conversationId: ConversationId
  readonly messageId: MessageId
}

export interface RetryRunDeps extends RunAgentTurnDeps {
  readonly messageContexts: MessageContextRepository
}

export async function retryRun(
  deps: RetryRunDeps,
  input: RetryRunInput,
): Promise<AgentRun> {
  const message = await deps.messages.findById(input.messageId)
  if (message === null) {
    throw new DomainError('messageNotFound', '要重试的消息不存在。', {
      entity: 'message',
      id: input.messageId,
      blockers: [],
    })
  }
  if (message.kind !== 'assistant') {
    throw new DomainError('messageNotRetryable', '只有助手的回答可以重试。', {
      entity: 'message',
      id: message.id,
      blockers: [],
    })
  }
  if (message.status !== 'failed' && message.status !== 'cancelled') {
    throw new DomainError('messageNotRetryable', '只有失败或已取消的回答可以重试。', {
      entity: 'message',
      id: message.id,
      blockers: [],
    })
  }
  const messages = await deps.messages.listByConversation(input.conversationId, 2000)
  const lastAssistant = [...messages].reverse().find((entry) => entry.kind === 'assistant')
  if (lastAssistant?.id !== message.id) {
    throw new DomainError('messageNotRetryable', '只能重试最后一条助手回答。', {
      entity: 'message',
      id: message.id,
      blockers: [],
    })
  }
  const userMessage = lastUserBefore(messages, message)
  if (userMessage === null) {
    throw new DomainError('messageNotRetryable', '这条回答之前没有用户消息，无法重试。', {
      entity: 'message',
      id: message.id,
      blockers: [],
    })
  }
  const contexts = await deps.messageContexts.listByMessage(userMessage.id)
  // The answer and every tool card after the user turn are replaced; the user
  // message is the point the retry starts from.
  await deps.messages.deleteAfter(input.conversationId, userMessage.seq)
  const retryInput: RunAgentTurnInput = {
    conversationId: input.conversationId,
    userMessage: {
      conversationId: userMessage.conversationId,
      kind: 'user',
      markdown: userMessage.markdown,
      attachmentIds: userMessage.attachmentIds,
      contexts,
    },
    existingUserMessageId: userMessage.id,
    model: null,
    activeResumeId: null,
  }
  return runAgentTurn(deps, retryInput)
}

function lastUserBefore(messages: readonly Message[], assistant: Message): Message | null {
  const before = messages.filter(
    (message) => message.seq < assistant.seq && message.kind === 'user',
  )
  return before.at(-1) ?? null
}
