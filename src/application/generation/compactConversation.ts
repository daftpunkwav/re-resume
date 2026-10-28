/**
 * @file compactConversation
 * @description Rolling summarisation of a long conversation. Once the transcript
 * is long enough to threaten the prompt budget, the messages older than the
 * recent window are compressed into one short summary that replaces them in
 * future prompts.
 *
 * Responsibilities:
 * - Decide whether compaction is due (message count and estimated tokens)
 * - Ask the model for one summary with no tools attached
 * - Store the summary and the sequence it covers on the conversation
 *
 * Constraints:
 * - A failed summarisation never fails the reply that triggered it: the caller
 *   keeps the truncated history and reports a warning.
 * - Only messages at or before the stored threshold are summarised; the recent
 *   window the model still reads is never folded away.
 */

import type { Conversation } from '../../domain/conversation/Conversation'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { MessageRepository } from '../../domain/conversation/ports/MessageRepository'
import type { ModelProvider } from '../../domain/generation/ports/ModelProvider'
import type { Clock } from '../../domain/shared/Clock'
import type { ConversationId } from '../../domain/shared/branded-id'
import { estimateTokens, truncateToTokens } from './context'

/** Message count above which compaction is considered. */
export const COMPACTION_MESSAGE_THRESHOLD = 30

/** Estimated token count above which compaction is considered. */
export const COMPACTION_TOKEN_THRESHOLD = 12_000

/** Upper bound of the stored summary, in estimated tokens. */
export const SUMMARY_TOKEN_LIMIT = 800

/** Messages kept out of the summary and read verbatim in later turns. */
export const SUMMARY_RECENT_WINDOW = 20

/** Upper bound of messages read while looking for the ones to summarise. */
const COMPACTION_READ_LIMIT = 2000

const SUMMARY_SYSTEM_PROMPT = [
  '把下面的对话压缩成一份中文摘要，供后续对话继续使用。',
  '保留：用户的目标岗位与要求、已经确认的事实与决定、尚未完成的待办、用户明确纠正过的内容。',
  `摘要不超过 ${SUMMARY_TOKEN_LIMIT} 个 token。只输出摘要正文。`,
].join('\n')

export interface CompactConversationDeps {
  readonly conversations: ConversationRepository
  readonly messages: MessageRepository
  readonly model: ModelProvider
  readonly clock: Clock
}

export interface CompactConversationInput {
  readonly conversationId: ConversationId
}

/**
 * Returns the updated conversation, or null when compaction was not due or the
 * model could not produce a summary.
 */
export async function compactConversation(
  deps: CompactConversationDeps,
  input: CompactConversationInput,
): Promise<Conversation | null> {
  const conversation = await deps.conversations.findById(input.conversationId)
  if (conversation === null) return null
  // The common case is a short conversation: one capped read settles it.
  const probe = await deps.messages.listByConversation(
    input.conversationId,
    COMPACTION_MESSAGE_THRESHOLD + 1,
  )
  if (probe.length <= COMPACTION_MESSAGE_THRESHOLD) return null
  const messages = await deps.messages.listByConversation(
    input.conversationId,
    COMPACTION_READ_LIMIT,
  )
  const estimated = messages.reduce((total, message) => total + estimateTokens(message.markdown), 0)
  if (estimated <= COMPACTION_TOKEN_THRESHOLD) return null

  const cutoff = messages[messages.length - SUMMARY_RECENT_WINDOW]?.seq
  if (cutoff === undefined) return null
  const firstSummarySeq = 1
  const throughSeq = cutoff - 1
  if (throughSeq < firstSummarySeq) return null
  const older = messages.filter((message) => message.seq <= throughSeq)
  if (older.length === 0) return null

  const transcript = older
    .filter((message) => message.kind !== 'tool')
    .map((message) => `${message.kind === 'user' ? '用户' : '助手'}：${message.markdown}`)
    .join('\n')
  if (transcript.trim() === '') return null

  const summary = await requestSummary(deps.model, transcript)
  if (summary === null) return null
  const stored = truncateToTokens(summary, SUMMARY_TOKEN_LIMIT).text
  if (stored.trim() === '') return null
  const updated: Conversation = {
    ...conversation,
    summary: stored,
    summaryThroughSeq: throughSeq,
    updatedAt: deps.clock.now(),
  }
  await deps.conversations.update(updated)
  return updated
}

/** Returns null on any model failure; compaction is best-effort. */
async function requestSummary(model: ModelProvider, transcript: string): Promise<string | null> {
  let answer = ''
  try {
    for await (const chunk of model.stream(
      {
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            parts: [{ kind: 'text', text: truncateToTokens(transcript, 8000).text }],
          },
        ],
        maxOutputTokens: 1024,
        temperature: 0,
      },
      [],
    )) {
      if (chunk.type === 'text') answer += chunk.textDelta
    }
  } catch {
    return null
  }
  return answer.trim() === '' ? null : answer
}
