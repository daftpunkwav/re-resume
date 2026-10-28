/**
 * @file conversationRepositories.test
 * @description Port contracts of the conversation area against a real SQLite
 * database: round trips, ordering, the run gate, cascade/RESTRICT behaviour and
 * the row-mapping failures. The schema comes from the shipped migration files.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AgentRun } from '../../../../src/domain/generation/AgentRun'
import type { Attachment } from '../../../../src/domain/conversation/Attachment'
import type { Conversation } from '../../../../src/domain/conversation/Conversation'
import type { JobPosting } from '../../../../src/domain/generation/JobPosting'
import type { Message } from '../../../../src/domain/conversation/Message'
import type { ToolInvocation } from '../../../../src/domain/generation/ToolInvocation'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import {
  asAgentRunId,
  asAttachmentId,
  asConversationId,
  asJobPostingId,
  asMessageId,
  asToolInvocationId,
} from '../../../../src/domain/shared/branded-id'
import { SqliteAgentRunRepository } from '../../../../src/infrastructure/persistence/conversation/SqliteAgentRunRepository'
import { SqliteAttachmentRepository } from '../../../../src/infrastructure/persistence/conversation/SqliteAttachmentRepository'
import { SqliteConversationRepository } from '../../../../src/infrastructure/persistence/conversation/SqliteConversationRepository'
import { SqliteJobPostingRepository } from '../../../../src/infrastructure/persistence/conversation/SqliteJobPostingRepository'
import { SqliteMessageContextRepository } from '../../../../src/infrastructure/persistence/conversation/SqliteMessageContextRepository'
import { SqliteMessageRepository } from '../../../../src/infrastructure/persistence/conversation/SqliteMessageRepository'
import { SqliteToolInvocationRepository } from '../../../../src/infrastructure/persistence/conversation/SqliteToolInvocationRepository'
import { RowMappingError } from '../../../../src/infrastructure/persistence/JsonEnvelope'
import { createMigratedDatabase } from '../../../support/nodeSqliteDatabase'
import type { NodeSqliteDatabase } from '../../../support/nodeSqliteDatabase'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const LATER: DateTime = parseDateTime('2026-01-01T00:00:05.000Z') as DateTime
const SHA = 'a'.repeat(64)

function aConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: asConversationId('conversation-1'),
    title: '新对话',
    providerId: null,
    modelId: null,
    pinned: false,
    activeResumeId: null,
    summary: null,
    summaryThroughSeq: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

function aMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: asMessageId('message-1'),
    conversationId: asConversationId('conversation-1'),
    seq: 1,
    kind: 'user',
    status: 'complete',
    markdown: '帮我整理简历。',
    attachmentIds: [],
    tool: null,
    runId: null,
    errorText: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

function anAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: asAttachmentId('attachment-1'),
    kind: 'image',
    mimeType: 'image/png',
    byteSize: 4,
    storageName: 'attachment-1.png',
    width: 640,
    height: 480,
    sha256: SHA,
    createdAt: AT,
    ...overrides,
  }
}

function aRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: asAgentRunId('run-1'),
    conversationId: asConversationId('conversation-1'),
    resumeId: null,
    jobPostingId: null,
    status: 'running',
    errorText: null,
    promptTokens: null,
    completionTokens: null,
    startedAt: AT,
    endedAt: null,
    ...overrides,
  }
}

function anInvocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    id: asToolInvocationId('invocation-1'),
    runId: asAgentRunId('run-1'),
    messageId: null,
    toolName: 'searchInfoEntries',
    risk: 'read',
    argsJson: '{"keyword":"前端"}',
    resultSummaryJson: null,
    changeIds: [],
    revisionId: null,
    status: 'failed',
    createdAt: AT,
    ...overrides,
  }
}

function aPosting(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: asJobPostingId('posting-1'),
    rawText: '招聘前端工程师',
    source: 'paste',
    imageAttachmentIds: [],
    conversationId: null,
    resumeId: null,
    parsed: null,
    parsedByRunId: null,
    parsedAt: null,
    createdAt: AT,
    ...overrides,
  }
}

describe('conversation repositories over SQLite', () => {
  let database: NodeSqliteDatabase
  let conversations: SqliteConversationRepository
  let messages: SqliteMessageRepository
  let contexts: SqliteMessageContextRepository
  let attachments: SqliteAttachmentRepository
  let jobPostings: SqliteJobPostingRepository
  let runs: SqliteAgentRunRepository
  let invocations: SqliteToolInvocationRepository

  beforeEach(() => {
    database = createMigratedDatabase()
    conversations = new SqliteConversationRepository(database)
    messages = new SqliteMessageRepository(database)
    contexts = new SqliteMessageContextRepository(database)
    attachments = new SqliteAttachmentRepository(database)
    jobPostings = new SqliteJobPostingRepository(database)
    runs = new SqliteAgentRunRepository(database)
    invocations = new SqliteToolInvocationRepository(database)
  })

  afterEach(() => {
    database.close()
  })

  it('round-trips a conversation and replaces it on update', async () => {
    const conversation = aConversation({ pinned: true, summary: '摘要', summaryThroughSeq: 3 })
    await conversations.insert(conversation)
    await expect(conversations.findById(conversation.id)).resolves.toEqual(conversation)

    const renamed: Conversation = { ...conversation, title: '改名后', updatedAt: LATER }
    await conversations.update(renamed)
    await expect(conversations.findById(conversation.id)).resolves.toEqual(renamed)
    await expect(conversations.listAll()).resolves.toHaveLength(1)

    await conversations.delete(conversation.id)
    await expect(conversations.findById(conversation.id)).resolves.toBeNull()
  })

  it('stores a message with its attachment links and context chips', async () => {
    await conversations.insert(aConversation())
    await attachments.insert(anAttachment())
    const message = aMessage({ attachmentIds: [asAttachmentId('attachment-1')] })
    await messages.insert(message)
    await contexts.insertAll([
      {
        messageId: message.id,
        context: { kind: 'entry', refId: asMessageId('entry-1') as never },
      },
    ])

    await expect(messages.findById(message.id)).resolves.toEqual(message)
    await expect(messages.findBySeq(message.conversationId, 1)).resolves.toEqual(message)
    await expect(contexts.listByMessage(message.id)).resolves.toHaveLength(1)
  })

  it('returns the most recent page of a conversation in sequence order', async () => {
    await conversations.insert(aConversation())
    for (let seq = 1; seq <= 5; seq += 1) {
      await messages.insert(aMessage({ id: asMessageId(`message-${seq}`), seq }))
    }

    const page = await messages.listByConversation(asConversationId('conversation-1'), 3)
    expect(page.map((message) => message.seq)).toEqual([3, 4, 5])
    await expect(messages.nextSeq(asConversationId('conversation-1'))).resolves.toBe(6)
  })

  it('updates a streamed assistant message', async () => {
    await conversations.insert(aConversation())
    const assistant = aMessage({
      id: asMessageId('assistant-1'),
      seq: 1,
      kind: 'assistant',
      status: 'streaming',
      markdown: '',
    })
    await messages.insert(assistant)
    await messages.update({ ...assistant, markdown: '你好', status: 'complete', updatedAt: LATER })

    const stored = await messages.findById(assistant.id)
    expect(stored?.markdown).toBe('你好')
    expect(stored?.status).toBe('complete')
  })

  it('deletes messages after a sequence, keeping the user turn it starts from', async () => {
    await conversations.insert(aConversation())
    await messages.insert(aMessage({ id: asMessageId('user-1'), seq: 1 }))
    await messages.insert(aMessage({ id: asMessageId('assistant-1'), seq: 2, kind: 'assistant', status: 'failed' }))
    await messages.insert(
      aMessage({
        id: asMessageId('tool-1'),
        seq: 3,
        kind: 'tool',
        status: 'failed',
        markdown: '',
        tool: {
          toolName: 'searchInfoEntries',
          invocationId: null,
          risk: 'read',
          label: '检索',
          detail: '',
          changeIds: [],
          revisionId: null,
          resumeId: null,
        },
      }),
    )

    await messages.deleteAfter(asConversationId('conversation-1'), 1)

    await expect(messages.listByConversation(asConversationId('conversation-1'), 10)).resolves.toMatchObject([
      { id: 'user-1' },
    ])
  })

  it('claims one run per conversation and returns the run already in flight', async () => {
    await conversations.insert(aConversation())
    const first = aRun()
    await expect(messages.createRun(first)).resolves.toEqual(first)
    await expect(runs.findById(first.id)).resolves.toEqual(first)

    const second = aRun({ id: asAgentRunId('run-2') })
    await expect(messages.createRun(second)).resolves.toEqual(first)
    await expect(runs.findById(second.id)).resolves.toBeNull()
    await expect(runs.findRunningByConversation(asConversationId('conversation-1'))).resolves.toEqual(first)
    await expect(runs.listRunning()).resolves.toHaveLength(1)
  })

  it('frees the run slot when the run finishes', async () => {
    await conversations.insert(aConversation())
    const first = aRun()
    await runs.create(first)
    await runs.save({ ...first, status: 'completed', endedAt: LATER })

    const second = aRun({ id: asAgentRunId('run-2') })
    await expect(messages.createRun(second)).resolves.toEqual(second)
  })

  it('clears a run conversation reference when the conversation is deleted', async () => {
    await conversations.insert(aConversation())
    await runs.create(aRun())
    await conversations.delete(asConversationId('conversation-1'))

    const stored = await runs.findById(asAgentRunId('run-1'))
    expect(stored?.conversationId).toBeNull()
    expect(stored?.status).toBe('running')
  })

  it('records an invocation once and replaces it when the call finishes', async () => {
    await conversations.insert(aConversation())
    await runs.create(aRun())
    await invocations.record(anInvocation())

    const finished = anInvocation({
      resultSummaryJson: '{"ok":true,"value":{"hits":3}}',
      status: 'ok',
    })
    await invocations.record(finished)

    await expect(invocations.listByRun(asAgentRunId('run-1'))).resolves.toEqual([finished])
  })

  it('stores an attachment once and finds it by digest', async () => {
    await attachments.insert(anAttachment())
    await expect(attachments.findById(asAttachmentId('attachment-1'))).resolves.toEqual(anAttachment())
    await expect(attachments.findBySha256(SHA)).resolves.toEqual(anAttachment())
    await expect(
      attachments.listByIds([asAttachmentId('attachment-1'), asAttachmentId('missing')]),
    ).resolves.toHaveLength(1)
    await expect(attachments.insert(anAttachment({ id: asAttachmentId('attachment-2') }))).rejects.toThrow()
  })

  it('reports an attachment row whose digest is not a SHA-256 value', async () => {
    await attachments.insert(anAttachment())
    await database.execute(`UPDATE attachment SET sha256 = 'nope' WHERE id = 'attachment-1'`)

    await expect(attachments.findById(asAttachmentId('attachment-1'))).rejects.toBeInstanceOf(
      RowMappingError,
    )
  })

  it('inserts a posting, updates it on save and lists the most recent first', async () => {
    await jobPostings.insert(aPosting())
    const parsed: JobPosting = {
      ...aPosting(),
      parsed: {
        title: '前端工程师',
        company: null,
        responsibilities: ['负责页面开发'],
        requirements: ['熟悉 TypeScript'],
        keywords: ['TypeScript'],
      },
      parsedByRunId: asAgentRunId('run-1'),
      parsedAt: LATER,
    }
    await jobPostings.save(parsed)
    await expect(jobPostings.findById(asJobPostingId('posting-1'))).resolves.toEqual(parsed)

    await jobPostings.insert(aPosting({ id: asJobPostingId('posting-2'), rawText: '另一份', createdAt: LATER }))
    const recent = await jobPostings.listRecent(1)
    expect(recent.map((posting) => posting.id)).toEqual(['posting-2'])
    await expect(jobPostings.save(aPosting({ id: asJobPostingId('missing') }))).rejects.toThrow()
  })

  it('reports a posting whose parsed payload has no provenance', async () => {
    await jobPostings.insert(aPosting())
    await database.execute(
      `UPDATE job_posting SET parsed_json = '{"v":1,"data":{"title":null,"company":null,"responsibilities":[],"requirements":[],"keywords":[]}}' WHERE id = 'posting-1'`,
    )

    await expect(jobPostings.findById(asJobPostingId('posting-1'))).rejects.toBeInstanceOf(
      RowMappingError,
    )
  })

  it('reports a run row a finished status without an end timestamp', async () => {
    await conversations.insert(aConversation())
    await runs.create(aRun())
    await database.execute(`UPDATE agent_run SET status = 'completed' WHERE id = 'run-1'`)

    await expect(runs.findById(asAgentRunId('run-1'))).rejects.toBeInstanceOf(RowMappingError)
  })
})
