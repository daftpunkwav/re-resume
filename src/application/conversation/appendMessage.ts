/**
 * @file appendMessage
 * @description Appends one message to a conversation and keeps the conversation
 * ordering timestamp in step.
 *
 * Responsibilities:
 * - Allocate the next sequence number and write the message row
 * - Validate the attachments the message names before anything is stored
 * - Store the context chips of the turn
 *
 * Constraints:
 * - The sequence number comes from the repository, not from a count: the unique
 *   index on (conversation_id, seq) is the final authority on ordering.
 * - A tool message carries a payload and a non-tool message does not; both the
 *   domain check and the persistence CHECK enforce it.
 */

import type { Message, MessageKind, ToolMessagePayload } from '../../domain/conversation/Message'
import {
  assertToolPayloadMatchesKind,
  initialMessageStatus,
} from '../../domain/conversation/Message'
import type { MessageContext } from '../../domain/conversation/MessageContext'
import type { AttachmentRepository } from '../../domain/conversation/ports/AttachmentRepository'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { MessageContextRepository } from '../../domain/conversation/ports/MessageContextRepository'
import type { MessageRepository } from '../../domain/conversation/ports/MessageRepository'
import { assertMessageAttachmentsAllowed } from '../../domain/conversation/Attachment'
import { DomainError } from '../../domain/shared/DomainError'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { AgentRunId, AttachmentId, ConversationId } from '../../domain/shared/branded-id'
import { asMessageId } from '../../domain/shared/branded-id'
import { findConversation } from './renameConversation'

export interface AppendMessageDeps {
  readonly conversations: ConversationRepository
  readonly messages: MessageRepository
  readonly messageContexts: MessageContextRepository
  readonly attachments: AttachmentRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface AppendMessageInput {
  readonly conversationId: ConversationId
  readonly kind: MessageKind
  /** Empty for tool messages. */
  readonly markdown?: string
  readonly attachmentIds?: readonly AttachmentId[]
  readonly contexts?: readonly MessageContext[]
  readonly tool?: ToolMessagePayload | null
  readonly runId?: AgentRunId | null
}

export async function appendMessage(
  deps: AppendMessageDeps,
  input: AppendMessageInput,
): Promise<Message> {
  const conversation = await findConversation(deps, input.conversationId)
  const attachmentIds = uniqueAttachmentIds(input.attachmentIds ?? [])
  await assertAttachmentsUsable(deps, attachmentIds)
  assertToolPayloadMatchesKind(input.kind, input.tool ?? null)
  const status = initialMessageStatus(input.kind)

  const now = deps.clock.now()
  const message: Message = {
    id: asMessageId(deps.ids.next()),
    conversationId: input.conversationId,
    seq: await deps.messages.nextSeq(input.conversationId),
    kind: input.kind,
    status,
    markdown: input.markdown ?? '',
    attachmentIds,
    tool: input.tool ?? null,
    runId: input.runId ?? null,
    errorText: null,
    createdAt: now,
    updatedAt: now,
  }
  await deps.messages.insert(message)
  const contexts = uniqueContexts(input.contexts ?? [])
  if (contexts.length > 0) {
    await deps.messageContexts.insertAll(
      contexts.map((context) => ({ messageId: message.id, context })),
    )
  }
  if (conversation.updatedAt !== now) {
    await deps.conversations.update({ ...conversation, updatedAt: now })
  }
  return message
}

async function assertAttachmentsUsable(
  deps: AppendMessageDeps,
  attachmentIds: readonly AttachmentId[],
): Promise<void> {
  if (attachmentIds.length === 0) return
  const found = await deps.attachments.listByIds(attachmentIds)
  if (found.length !== attachmentIds.length) {
    const known = new Set(found.map((attachment) => attachment.id))
    const missing = attachmentIds.filter((id) => !known.has(id))
    throw new DomainError('attachmentNotFound', '消息引用的附件不存在。', {
      entity: 'attachment',
      id: missing[0] ?? '',
      blockers: missing,
    })
  }
  assertMessageAttachmentsAllowed(found)
}

function uniqueAttachmentIds(ids: readonly AttachmentId[]): readonly AttachmentId[] {
  const seen = new Set<string>()
  const unique: AttachmentId[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return unique
}

function uniqueContexts(contexts: readonly MessageContext[]): readonly MessageContext[] {
  const seen = new Set<string>()
  const unique: MessageContext[] = []
  for (const context of contexts) {
    const key = `${context.kind}:${context.refId}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(context)
  }
  return unique
}
