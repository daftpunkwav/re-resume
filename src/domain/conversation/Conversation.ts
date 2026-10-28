/**
 * @file Conversation
 * @description A stored conversation with the assistant: its title, the model
 * it was last run on, and the resume the turns are focused on.
 *
 * Responsibilities:
 * - Declare the persisted shape of a conversation
 * - Validate and normalise a title at every entry point that accepts one
 * - Group conversations for the sidebar by the day they were last updated
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - `providerId`/`modelId` are nullable overrides; null means "use the active
 *   provider from settings", which keeps a conversation portable when the user
 *   switches services.
 */

import { DomainError } from '../shared/DomainError'
import type { DateTime } from '../shared/DateTime'
import type { ConversationId, ResumeId } from '../shared/branded-id'

/** The title a conversation gets when the user does not name it. */
export const DEFAULT_CONVERSATION_TITLE = '新对话'

/** Upper bound in code points, not UTF-16 units. */
export const CONVERSATION_TITLE_MAX_LENGTH = 60

export interface Conversation {
  readonly id: ConversationId
  readonly title: string
  /** null = use the globally active provider. */
  readonly providerId: string | null
  readonly modelId: string | null
  readonly pinned: boolean
  readonly activeResumeId: ResumeId | null
  /** Rolling summary that replaces messages older than `summaryThroughSeq`. */
  readonly summary: string | null
  readonly summaryThroughSeq: number | null
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

export const CONVERSATION_GROUPS = ['today', 'last7Days', 'earlier'] as const

export type ConversationGroup = (typeof CONVERSATION_GROUPS)[number]

/**
 * Validates and normalises a user-supplied title. Trimming happens before the
 * length check so trailing whitespace cannot push a legal title over the limit.
 */
export function normaliseConversationTitle(raw: string): string {
  const title = raw.trim()
  if (title === '') {
    throw new DomainError('blankRequiredField', '会话标题不能为空。')
  }
  if (codePointLength(title) > CONVERSATION_TITLE_MAX_LENGTH) {
    throw new DomainError(
      'fieldTooLong',
      `会话标题不能超过 ${CONVERSATION_TITLE_MAX_LENGTH} 个字符。`,
    )
  }
  return title
}

/** The fallback title derived from the first user message, before the model is asked. */
export function truncatedConversationTitle(firstUserMessage: string, maxLength = 24): string {
  const trimmed = firstUserMessage.trim()
  const codePoints = [...trimmed]
  if (codePoints.length <= maxLength) return trimmed
  return codePoints.slice(0, maxLength).join('').trim()
}

/**
 * Which sidebar group a conversation belongs to. The comparison is on the UTC
 * calendar day because timestamps are stored in UTC; the interface localises
 * the labels, not the grouping key.
 */
export function conversationGroupFor(updatedAt: DateTime, now: DateTime): ConversationGroup {
  const updatedDay = Date.parse(`${updatedAt.slice(0, 10)}T00:00:00.000Z`)
  const currentDay = Date.parse(`${now.slice(0, 10)}T00:00:00.000Z`)
  const dayDistance = Math.floor((currentDay - updatedDay) / 86_400_000)
  if (dayDistance <= 0) return 'today'
  if (dayDistance < 7) return 'last7Days'
  return 'earlier'
}

function codePointLength(text: string): number {
  return [...text].length
}
