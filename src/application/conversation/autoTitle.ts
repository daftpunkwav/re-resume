/**
 * @file autoTitle
 * @description Names a conversation after its first user message. The fallback
 * is the first 24 code points, so a title exists even when no model is
 * configured or the naming call fails; a model improves it when available.
 *
 * Constraints:
 * - The naming call is one request with no tools and a tiny output budget: a
 *   conversation title is a convenience, never a reason to keep a turn waiting.
 */

import {
  DEFAULT_CONVERSATION_TITLE,
  truncatedConversationTitle,
} from '../../domain/conversation/Conversation'
import type { Conversation } from '../../domain/conversation/Conversation'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { ModelProvider } from '../../domain/generation/ports/ModelProvider'
import type { Clock } from '../../domain/shared/Clock'
import type { ConversationId } from '../../domain/shared/branded-id'
import { findConversation } from './renameConversation'

/** Longest candidate the fallback produces, in code points. */
export const AUTO_TITLE_FALLBACK_LENGTH = 24

/** Upper bound of a title, in code points; the column enforces the same bound. */
const AUTO_TITLE_MAX_LENGTH = 60

/** Output budget for the naming request; a title needs only a few tokens. */
const AUTO_TITLE_MAX_OUTPUT_TOKENS = 32

/** Prompt sent to the model; the reply is expected to be the title only. */
const AUTO_TITLE_SYSTEM_PROMPT = [
  '为下面这段对话的第一条用户消息起一个简洁的中文标题。',
  '只输出标题本身，不要引号、句号或解释。',
  '标题不超过 20 个汉字。',
].join('')

export interface AutoTitleDeps {
  readonly conversations: ConversationRepository
  /** null when no provider is configured; the fallback title is used instead. */
  readonly model: ModelProvider | null
  readonly clock: Clock
}

export interface AutoTitleInput {
  readonly conversationId: ConversationId
  readonly firstUserMessage: string
}

export async function autoTitleConversation(
  deps: AutoTitleDeps,
  input: AutoTitleInput,
): Promise<Conversation> {
  const conversation = await findConversation(deps, input.conversationId)
  const fallback = truncatedConversationTitle(input.firstUserMessage, AUTO_TITLE_FALLBACK_LENGTH)
  const generated =
    deps.model === null ? null : await askModelForTitle(deps.model, input.firstUserMessage)
  const normalised = generated === null ? null : normaliseGeneratedTitle(generated)
  const title =
    normalised ?? (fallback === '' ? DEFAULT_CONVERSATION_TITLE : fallback)
  const now = deps.clock.now()
  const updated: Conversation = { ...conversation, title, updatedAt: now }
  await deps.conversations.update(updated)
  return updated
}

/** Never throws: a failed naming call falls back to the truncated title. */
async function askModelForTitle(model: ModelProvider, firstUserMessage: string): Promise<string> {
  const prompt = firstUserMessage.trim().slice(0, 600)
  if (prompt === '') return ''
  let answer = ''
  try {
    for await (const chunk of model.stream(
      {
        system: AUTO_TITLE_SYSTEM_PROMPT,
        messages: [{ role: 'user', parts: [{ kind: 'text', text: prompt }] }],
        maxOutputTokens: AUTO_TITLE_MAX_OUTPUT_TOKENS,
        temperature: 0,
      },
      [],
    )) {
      if (chunk.type === 'text') answer += chunk.textDelta
      // A title request has no tools; a usage frame ends the answer.
      if (chunk.type === 'usage') break
    }
  } catch {
    return ''
  }
  return answer
}

/**
 * A model reply can arrive with quoting or a trailing explanation; the first
 * line without wrapping punctuation is the title.
 */
function normaliseGeneratedTitle(answer: string): string | null {
  const firstLine = answer.trim().split('\n')[0]?.trim() ?? ''
  const stripped = firstLine.replace(/^["'「『《]+/u, '').replace(/["'」』》。.!！]+$/u, '').trim()
  if (stripped === '') return null
  const codePoints = [...stripped]
  return codePoints.length <= AUTO_TITLE_MAX_LENGTH
    ? stripped
    : codePoints.slice(0, AUTO_TITLE_MAX_LENGTH).join('')
}
