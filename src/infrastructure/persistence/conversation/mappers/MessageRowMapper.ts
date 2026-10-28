/**
 * @file MessageRowMapper
 * @description Row to domain conversion for messages, including the tool card
 * payload stored as a JSON envelope. The attachment identifiers are not part of
 * the row: the repository reads them from the join table and attaches them here.
 *
 * Constraints:
 * - Tool payload fields are re-branded at the boundary, so the domain never
 *   sees a raw string where an identifier belongs.
 * - A tool message always carries its payload and a non-tool message never
 *   does; the CHECK constraint and this mapper both enforce it.
 */

import { isMessageKind, isMessageStatus } from '../../../../domain/conversation/Message'
import type {
  Message,
  MessageKind,
  MessageStatus,
  ToolMessagePayload,
} from '../../../../domain/conversation/Message'
import { isToolRisk } from '../../../../domain/generation/ToolRisk'
import {
  asAgentRunId,
  asAttachmentId,
  asChangeRecordId,
  asConversationId,
  asMessageId,
  asResumeId,
  asRevisionId,
  asToolInvocationId,
} from '../../../../domain/shared/branded-id'
import type { DateTime } from '../../../../domain/shared/DateTime'
import { RowMappingError, readJsonRecordEnvelope, writeJsonEnvelope } from '../../JsonEnvelope'
import {
  nullableText,
  requiredInteger,
  requiredText,
  requiredTimestamp,
  textValue,
} from './ConversationRowMapper'

export interface MessageRow {
  readonly id: unknown
  readonly conversation_id: unknown
  readonly seq: unknown
  readonly kind: unknown
  readonly status: unknown
  readonly markdown: unknown
  readonly tool_json: unknown
  readonly run_id: unknown
  readonly error_text: unknown
  readonly created_at: unknown
  readonly updated_at: unknown
}

export function toMessageRow(message: Message): {
  readonly id: string
  readonly conversation_id: string
  readonly seq: number
  readonly kind: string
  readonly status: string
  readonly markdown: string
  readonly tool_json: string | null
  readonly run_id: string | null
  readonly error_text: string | null
  readonly created_at: DateTime
  readonly updated_at: DateTime
} {
  return {
    id: message.id,
    conversation_id: message.conversationId,
    seq: message.seq,
    kind: message.kind,
    status: message.status,
    markdown: message.markdown,
    tool_json: message.tool === null ? null : writeJsonEnvelope(toolPayloadToJson(message.tool)),
    run_id: message.runId,
    error_text: message.errorText,
    created_at: message.createdAt,
    updated_at: message.updatedAt,
  }
}

export function fromMessageRow(row: MessageRow, attachmentIds: readonly string[]): Message {
  const kind = row.kind
  if (!isMessageKind(kind)) {
    throw new RowMappingError('message.kind', 'value is not one of the message kinds', kind)
  }
  const status = row.status
  if (!isMessageStatus(status)) {
    throw new RowMappingError('message.status', 'value is not one of the message statuses', status)
  }
  assertStatusBelongsToKind(status, kind)
  const tool = row.tool_json === null ? null : readToolPayload(row.tool_json)
  if (kind === 'tool' && tool === null) {
    throw new RowMappingError('message.tool_json', 'a tool message must carry its payload', row.tool_json)
  }
  if (kind !== 'tool' && tool !== null) {
    throw new RowMappingError('message.tool_json', 'only a tool message may carry a payload', row.tool_json)
  }
  return {
    id: asMessageId(requiredText(row.id, 'message.id')),
    conversationId: asConversationId(requiredText(row.conversation_id, 'message.conversation_id')),
    seq: requiredInteger(row.seq, 'message.seq'),
    kind,
    status,
    markdown: textValue(row.markdown, 'message.markdown'),
    attachmentIds: attachmentIds.map(asAttachmentId),
    tool,
    runId:
      row.run_id === null || row.run_id === undefined
        ? null
        : asAgentRunId(requiredText(row.run_id, 'message.run_id')),
    errorText: nullableText(row.error_text, 'message.error_text'),
    createdAt: requiredTimestamp(row.created_at, 'message.created_at'),
    updatedAt: requiredTimestamp(row.updated_at, 'message.updated_at'),
  }
}

function assertStatusBelongsToKind(status: MessageStatus, kind: MessageKind): void {
  const allowed =
    kind === 'user'
      ? status === 'complete'
      : kind === 'assistant'
        ? status === 'streaming' || status === 'complete' || status === 'cancelled' || status === 'failed'
        : status === 'running' || status === 'complete' || status === 'failed'
  if (!allowed) {
    throw new RowMappingError(
      'message.status',
      `status ${status} is not reachable for a ${kind} message`,
      status,
    )
  }
}

function readToolPayload(raw: unknown): ToolMessagePayload {
  const record = readJsonRecordEnvelope(raw, 'message.tool_json')
  const risk = record.risk
  if (!isToolRisk(risk)) {
    throw new RowMappingError('message.tool_json.risk', 'value is not one of the tool risks', risk)
  }
  const changeIds = record.changeIds
  if (!Array.isArray(changeIds) || changeIds.some((id) => typeof id !== 'string')) {
    throw new RowMappingError(
      'message.tool_json.changeIds',
      'expected an array of identifiers',
      changeIds,
    )
  }
  const invocationId = record.invocationId
  const revisionId = record.revisionId
  const resumeId = record.resumeId
  if (invocationId !== null && typeof invocationId !== 'string') {
    throw new RowMappingError('message.tool_json.invocationId', 'expected an identifier or null', invocationId)
  }
  if (revisionId !== null && typeof revisionId !== 'string') {
    throw new RowMappingError('message.tool_json.revisionId', 'expected an identifier or null', revisionId)
  }
  if (resumeId !== null && typeof resumeId !== 'string') {
    throw new RowMappingError('message.tool_json.resumeId', 'expected an identifier or null', resumeId)
  }
  return {
    toolName: requiredText(record.toolName, 'message.tool_json.toolName'),
    invocationId: invocationId === null ? null : asToolInvocationId(invocationId),
    risk,
    label: requiredText(record.label, 'message.tool_json.label'),
    detail: textValue(record.detail, 'message.tool_json.detail'),
    changeIds: changeIds.map(asChangeRecordId),
    revisionId: revisionId === null ? null : asRevisionId(revisionId),
    resumeId: resumeId === null ? null : asResumeId(resumeId),
  }
}

function toolPayloadToJson(tool: ToolMessagePayload): Record<string, unknown> {
  return {
    toolName: tool.toolName,
    invocationId: tool.invocationId,
    risk: tool.risk,
    label: tool.label,
    detail: tool.detail,
    changeIds: [...tool.changeIds],
    revisionId: tool.revisionId,
    resumeId: tool.resumeId,
  }
}
