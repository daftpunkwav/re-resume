/**
 * @file mappers.test
 * @description Row-to-domain mapping of the conversation area, independent of
 * SQLite: the mapper is the component that must report a row the schema could
 * not have written (a hand-edited database, a future schema this build does not
 * know, an unknown envelope version).
 */

import { describe, expect, it } from 'vitest'

import { RowMappingError } from '../../../../src/infrastructure/persistence/JsonEnvelope'
import { fromAgentRunRow, fromToolInvocationRow } from '../../../../src/infrastructure/persistence/conversation/mappers/AgentRunRowMapper'
import { fromAttachmentRow } from '../../../../src/infrastructure/persistence/conversation/mappers/AttachmentRowMapper'
import { fromConversationRow } from '../../../../src/infrastructure/persistence/conversation/mappers/ConversationRowMapper'
import { fromJobPostingRow } from '../../../../src/infrastructure/persistence/conversation/mappers/JobPostingRowMapper'
import { fromMessageRow } from '../../../../src/infrastructure/persistence/conversation/mappers/MessageRowMapper'

const AT = '2026-01-01T00:00:00.000Z'
const ENVELOPE = '{"v":1,"data":[]}'

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conversation-1',
    title: '新对话',
    provider_id: null,
    model_id: null,
    pinned: 0,
    active_resume_id: null,
    summary: null,
    summary_through_seq: null,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  }
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    conversation_id: 'conversation-1',
    seq: 1,
    kind: 'user',
    status: 'complete',
    markdown: '',
    tool_json: null,
    run_id: null,
    error_text: null,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  }
}

function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attachment-1',
    kind: 'image',
    mime_type: 'image/png',
    byte_size: 4,
    storage_name: 'attachment-1.png',
    width: null,
    height: null,
    sha256: 'a'.repeat(64),
    created_at: AT,
    ...overrides,
  }
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    conversation_id: 'conversation-1',
    resume_id: null,
    job_posting_id: null,
    status: 'running',
    error_text: null,
    prompt_tokens: null,
    completion_tokens: null,
    started_at: AT,
    ended_at: null,
    ...overrides,
  }
}

function invocationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invocation-1',
    run_id: 'run-1',
    message_id: null,
    tool_name: 'searchInfoEntries',
    risk: 'read',
    args_json: '{"v":1,"data":"{}"}',
    result_summary_json: null,
    change_ids_json: ENVELOPE,
    revision_id: null,
    status: 'ok',
    created_at: AT,
    ...overrides,
  }
}

function postingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'posting-1',
    raw_text: '招聘前端工程师',
    source: 'paste',
    image_attachment_ids: ENVELOPE,
    conversation_id: null,
    resume_id: null,
    parsed_json: null,
    parsed_by_run_id: null,
    parsed_at: null,
    created_at: AT,
    ...overrides,
  }
}

describe('conversation row mappers', () => {
  it('re-builds a conversation and rejects a flag other than 0/1', () => {
    expect(fromConversationRow(conversationRow())).toMatchObject({ id: 'conversation-1', pinned: false })
    expect(() => fromConversationRow(conversationRow({ pinned: 2 }))).toThrow(RowMappingError)
    expect(() => fromConversationRow(conversationRow({ title: '' }))).toThrow(RowMappingError)
    expect(() => fromConversationRow(conversationRow({ created_at: 'soon' }))).toThrow(RowMappingError)
  })

  it('re-builds a message and enforces the tool-payload/kind rule', () => {
    expect(fromMessageRow(messageRow(), [])).toMatchObject({ kind: 'user', attachmentIds: [] })
    expect(() => fromMessageRow(messageRow({ kind: 'shout' }), [])).toThrow(RowMappingError)
    expect(() => fromMessageRow(messageRow({ status: 'awaiting' }), [])).toThrow(RowMappingError)
    expect(() => fromMessageRow(messageRow({ status: 'running' }), [])).toThrow(RowMappingError)
    expect(() => fromMessageRow(messageRow({ kind: 'tool' }), [])).toThrow(RowMappingError)
    expect(() =>
      fromMessageRow(
        messageRow({ kind: 'tool', status: 'running', tool_json: ENVELOPE }),
        [],
      ),
    ).toThrow(RowMappingError)
    expect(() =>
      fromMessageRow(messageRow({ tool_json: '{"v":2,"data":{}}' }), []),
    ).toThrow(RowMappingError)
  })

  it('re-builds an attachment and rejects a malformed digest', () => {
    expect(fromAttachmentRow(attachmentRow())).toMatchObject({ kind: 'image' })
    expect(() => fromAttachmentRow(attachmentRow({ sha256: 'ABCDEF' }))).toThrow(RowMappingError)
    expect(() => fromAttachmentRow(attachmentRow({ byte_size: 0 }))).toThrow(RowMappingError)
    expect(() => fromAttachmentRow(attachmentRow({ kind: 'video' }))).toThrow(RowMappingError)
  })

  it('re-builds a run and requires an end timestamp for a finished run', () => {
    expect(fromAgentRunRow(runRow())).toMatchObject({ status: 'running', endedAt: null })
    expect(() => fromAgentRunRow(runRow({ status: 'completed' }))).toThrow(RowMappingError)
    expect(() => fromAgentRunRow(runRow({ status: 'awaitingConfirmation' }))).toThrow(RowMappingError)
  })

  it('re-builds an invocation and rejects the v1 risk set', () => {
    expect(fromToolInvocationRow(invocationRow())).toMatchObject({ risk: 'read', status: 'ok' })
    expect(() => fromToolInvocationRow(invocationRow({ risk: 'destructive' }))).toThrow(
      RowMappingError,
    )
    expect(() => fromToolInvocationRow(invocationRow({ change_ids_json: '[]' }))).toThrow(
      RowMappingError,
    )
  })

  it('re-builds a posting and requires parse provenance', () => {
    expect(fromJobPostingRow(postingRow())).toMatchObject({ rawText: '招聘前端工程师' })
    expect(() =>
      fromJobPostingRow(
        postingRow({
          parsed_json:
            '{"v":1,"data":{"title":null,"company":null,"responsibilities":[],"requirements":[],"keywords":[]}}',
        }),
      ),
    ).toThrow(RowMappingError)
    expect(() => fromJobPostingRow(postingRow({ image_attachment_ids: '{"v":9,"data":[]}' }))).toThrow(
      RowMappingError,
    )
  })
})
