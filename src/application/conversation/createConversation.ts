/**
 * @file createConversation
 * @description Creates an empty conversation. The title defaults to 「新对话」;
 * a supplied title is normalised by the domain before it is stored.
 */

import {
  DEFAULT_CONVERSATION_TITLE,
  normaliseConversationTitle,
} from '../../domain/conversation/Conversation'
import type { Conversation } from '../../domain/conversation/Conversation'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { ResumeId } from '../../domain/shared/branded-id'
import { asConversationId } from '../../domain/shared/branded-id'

export interface CreateConversationDeps {
  readonly conversations: ConversationRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface CreateConversationInput {
  readonly title?: string
  readonly providerId?: string | null
  readonly modelId?: string | null
  readonly activeResumeId?: ResumeId | null
}

export async function createConversation(
  deps: CreateConversationDeps,
  input: CreateConversationInput = {},
): Promise<Conversation> {
  const now = deps.clock.now()
  const conversation: Conversation = {
    id: asConversationId(deps.ids.next()),
    title:
      input.title === undefined
        ? DEFAULT_CONVERSATION_TITLE
        : normaliseConversationTitle(input.title),
    providerId: emptyToNull(input.providerId),
    modelId: emptyToNull(input.modelId),
    pinned: false,
    activeResumeId: input.activeResumeId ?? null,
    summary: null,
    summaryThroughSeq: null,
    createdAt: now,
    updatedAt: now,
  }
  await deps.conversations.insert(conversation)
  return conversation
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
