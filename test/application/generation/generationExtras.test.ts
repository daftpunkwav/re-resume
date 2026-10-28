/**
 * @file generationExtras.test
 * @description The smaller generation use cases and helpers: retry, crash
 * recovery, rolling summary, the tool execution pipeline, cancellation state and
 * the redaction conventions.
 */

import { describe, expect, it } from 'vitest'

import { appendMessage } from '../../../src/application/conversation/appendMessage'
import { createConversation } from '../../../src/application/conversation/createConversation'
import { ActiveRunRegistry } from '../../../src/application/generation/activeRunRegistry'
import { cancelRun } from '../../../src/application/generation/cancelRun'
import { compactConversation } from '../../../src/application/generation/compactConversation'
import { recoverInterruptedRuns } from '../../../src/application/generation/recoverInterruptedRuns'
import { redactJsonSecrets, redactSecret } from '../../../src/application/generation/redactSecret'
import { retryRun } from '../../../src/application/generation/retryRun'
import { runAgentTurn } from '../../../src/application/generation/runAgentTurn'
import type { RunAgentTurnDeps } from '../../../src/application/generation/runAgentTurn'
import { buildToolRegistry } from '../../../src/application/generation/buildToolRegistry'
import { summarizeToolArgs } from '../../../src/application/generation/toolArgsSummary'
import { executeToolCall } from '../../../src/application/generation/toolExecution'
import {
  EMPTY_TOOL_OUTCOME,
  readToolOutcomeMetadata,
  successResultJson,
  summarizeToolOutcome,
  truncateToolResult,
} from '../../../src/application/generation/toolOutcome'
import type { Conversation } from '../../../src/domain/conversation/Conversation'
import type { Message } from '../../../src/domain/conversation/Message'
import type { RegisteredTool, ToolContext } from '../../../src/domain/generation/ports/ToolRegistry'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { err, ok } from '../../../src/domain/shared/Result'
import {
  asAgentRunId,
  asConversationId,
  asMessageId,
} from '../../../src/domain/shared/branded-id'
import { createConversationBed } from '../../support/conversationBed'
import type { ConversationBed } from '../../support/conversationBed'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

function turnDeps(
  bed: ConversationBed,
  overrides: Partial<RunAgentTurnDeps> = {},
): RunAgentTurnDeps {
  return {
    model: bed.model,
    titleModel: null,
    registry: buildToolRegistry(),
    conversations: bed.conversations,
    messages: bed.messages,
    messageContexts: bed.messageContexts,
    runs: bed.runs,
    invocations: bed.invocations,
    jobPostings: bed.jobPostings,
    attachments: bed.attachments,
    fileStore: bed.fileStore,
    clock: bed.clock,
    ids: bed.ids,
    emit: bed.emit,
    signal: new AbortController().signal,
    secrets: [],
    ...overrides,
  }
}

async function newConversation(bed: ConversationBed): Promise<Conversation> {
  return createConversation({ conversations: bed.conversations, clock: bed.clock, ids: bed.ids }, {})
}

function appendDeps(bed: ConversationBed) {
  return {
    conversations: bed.conversations,
    messages: bed.messages,
    messageContexts: bed.messageContexts,
    attachments: bed.attachments,
    clock: bed.clock,
    ids: bed.ids,
  }
}

function aUserMessage(conversationId: Conversation['id'], seq = 1): Message {
  return {
    id: asMessageId(`message-${seq}`),
    conversationId,
    seq,
    kind: 'user',
    status: 'complete',
    markdown: '帮我整理简历',
    attachmentIds: [],
    tool: null,
    runId: null,
    errorText: null,
    createdAt: AT,
    updatedAt: AT,
  }
}

describe('cancelRun and the active run registry', () => {
  it('aborts the run in flight and releases the slot afterwards', async () => {
    const registry = new ActiveRunRegistry()
    const conversationId = asConversationId('conversation-1')
    let observedSignal: AbortSignal | null = null

    const result = registry.run(conversationId, async (signal) => {
      observedSignal = signal
      expect(registry.isRunning(conversationId)).toBe(true)
      await cancelRun({ activeRuns: registry }, { conversationId })
      expect(signal.aborted).toBe(true)
      return 'done'
    })

    await expect(result).resolves.toBe('done')
    expect(observedSignal).not.toBeNull()
    expect(registry.isRunning(conversationId)).toBe(false)
    await expect(cancelRun({ activeRuns: registry }, { conversationId })).resolves.toBe(false)
  })

  it('shares the signal with a second caller and only the owner releases the slot', async () => {
    const registry = new ActiveRunRegistry()
    const conversationId = asConversationId('conversation-1')
    const signals: AbortSignal[] = []

    await registry.run(conversationId, async (first) => {
      signals.push(first)
      await registry.run(conversationId, async (second) => {
        signals.push(second)
      })
    })

    expect(signals[0]).toBe(signals[1])
    expect(registry.isRunning(conversationId)).toBe(false)
  })
})

describe('retryRun', () => {
  it('removes the failed answer, reuses the user turn and starts a new run', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const user = await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'user',
      markdown: '帮我整理简历',
    })
    const assistant = await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'assistant',
      markdown: '一半的回答',
    })
    await bed.messages.update({
      ...assistant,
      status: 'failed',
      errorText: '超时',
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '完整的回答。' }] })

    const run = await retryRun(turnDeps(bed), {
      conversationId: conversation.id,
      messageId: assistant.id,
    })

    expect(run.status).toBe('completed')
    const messages = await bed.messages.listByConversation(conversation.id, 10)
    expect(messages.map((message) => message.kind)).toEqual(['user', 'assistant'])
    expect(messages[0]?.id).toBe(user.id)
    expect(messages[0]?.seq).toBe(1)
    expect(messages[1]?.markdown).toBe('完整的回答。')
    expect(messages[1]?.status).toBe('complete')
  })

  it('refuses a message that is not a retryable assistant turn', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const user = await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'user',
      markdown: '你好',
    })

    await expect(
      retryRun(turnDeps(bed), { conversationId: conversation.id, messageId: user.id }),
    ).rejects.toMatchObject({ code: 'messageNotRetryable' })
    await expect(
      retryRun(turnDeps(bed), {
        conversationId: conversation.id,
        messageId: asMessageId('missing'),
      }),
    ).rejects.toMatchObject({ code: 'messageNotFound' })
  })

  it('refuses an answer that is not the last assistant message', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'user',
      markdown: '第一问',
    })
    const firstAnswer = await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'assistant',
      markdown: '答一',
    })
    await bed.messages.update({ ...firstAnswer, status: 'failed', errorText: '失败' })
    await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'user',
      markdown: '第二问',
    })
    await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'assistant',
      markdown: '答二',
    })

    await expect(
      retryRun(turnDeps(bed), {
        conversationId: conversation.id,
        messageId: firstAnswer.id,
      }),
    ).rejects.toMatchObject({ code: 'messageNotRetryable' })
  })
})

describe('recoverInterruptedRuns', () => {
  it('fails the interrupted run and repairs its streaming messages', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const run = await bed.messages.createRun({
      id: asAgentRunId('run-1'),
      conversationId: conversation.id,
      resumeId: null,
      jobPostingId: null,
      status: 'running',
      errorText: null,
      promptTokens: null,
      completionTokens: null,
      startedAt: AT,
      endedAt: null,
    })
    await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'user',
      markdown: '你好',
    })
    const streaming = await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'assistant',
      markdown: '半个回答',
      runId: run.id,
    })
    const tool = await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'tool',
      runId: run.id,
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
    })

    const summary = await recoverInterruptedRuns({
      runs: bed.runs,
      messages: bed.messages,
      clock: bed.clock,
    })

    expect(summary).toEqual({ failedRuns: 1, repairedMessages: 2 })
    await expect(bed.runs.findById(run.id)).resolves.toMatchObject({
      status: 'failed',
      errorText: '上次运行被中断',
    })
    const messages = await bed.messages.listByConversation(conversation.id, 10)
    expect(messages.find((message) => message.id === streaming.id)).toMatchObject({
      status: 'cancelled',
    })
    expect(messages.find((message) => message.id === tool.id)).toMatchObject({ status: 'failed' })
    // The user turn is untouched.
    expect(messages.find((message) => message.kind === 'user')?.status).toBe('complete')
  })

  it('does nothing when no run was left running', async () => {
    const bed = createConversationBed()
    await expect(
      recoverInterruptedRuns({ runs: bed.runs, messages: bed.messages, clock: bed.clock }),
    ).resolves.toEqual({ failedRuns: 0, repairedMessages: 0 })
  })
})

describe('compactConversation', () => {
  async function seedLongConversation(bed: ConversationBed): Promise<Conversation> {
    const conversation = await newConversation(bed)
    for (let seq = 1; seq <= 31; seq += 1) {
      await bed.messages.insert({
        id: asMessageId(`message-${seq}`),
        conversationId: conversation.id,
        seq,
        kind: seq % 2 === 0 ? 'assistant' : 'user',
        status: 'complete',
        markdown: 'x'.repeat(2000),
        attachmentIds: [],
        tool: null,
        runId: null,
        errorText: null,
        createdAt: AT,
        updatedAt: AT,
      })
    }
    return conversation
  }

  it('stores a summary and the covered sequence once the transcript is long', async () => {
    const bed = createConversationBed()
    const conversation = await seedLongConversation(bed)
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '此前的对话摘要。' }] })

    const updated = await compactConversation(
      {
        conversations: bed.conversations,
        messages: bed.messages,
        model: bed.model,
        clock: bed.clock,
      },
      { conversationId: conversation.id },
    )

    expect(updated?.summary).toBe('此前的对话摘要。')
    // The recent window (20 messages) stays readable; the summary covers the 11
    // messages before it.
    expect(updated?.summaryThroughSeq).toBe(11)
  })

  it('does not compact a short transcript', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    await expect(
      compactConversation(
        { conversations: bed.conversations, messages: bed.messages, model: bed.model, clock: bed.clock },
        { conversationId: conversation.id },
      ),
    ).resolves.toBeNull()
    expect(bed.model.calls).toBe(0)
  })

  it('leaves the conversation alone when the summary call fails', async () => {
    const bed = createConversationBed()
    const conversation = await seedLongConversation(bed)
    bed.model.enqueue({ error: new Error('busy') })

    await expect(
      compactConversation(
        { conversations: bed.conversations, messages: bed.messages, model: bed.model, clock: bed.clock },
        { conversationId: conversation.id },
      ),
    ).resolves.toBeNull()
  })
})

describe('the tool execution pipeline', () => {
  function contextOf(bed: ConversationBed, conversationId: Conversation['id']): ToolContext {
    return {
      conversations: bed.conversations,
      messages: bed.messages,
      jobPostings: bed.jobPostings,
      attachments: bed.attachments,
      fileStore: bed.fileStore,
      clock: bed.clock,
      ids: bed.ids,
      runId: asAgentRunId('run-1'),
      conversationId,
      emit: bed.emit,
    }
  }

  function registryOf(tools: readonly RegisteredTool<unknown, unknown>[]) {
    return {
      list: () => tools,
      get: (name: string) => tools.find((tool) => tool.name === name),
      schemas: () => [],
      labelFor: (name: string) => (name === 'searchInfoEntries' ? '检索信息条目' : name),
    }
  }

  async function prepared(bed: ConversationBed, tool: RegisteredTool<unknown, unknown>) {
    const conversation = await newConversation(bed)
    const message = await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'tool',
      tool: {
        toolName: tool.name,
        invocationId: null,
        risk: tool.risk,
        label: '检索',
        detail: '',
        changeIds: [],
        revisionId: null,
        resumeId: null,
      },
    })
    return { conversation, message }
  }

  it('records a successful call and reports the identifiers it names', async () => {
    const bed = createConversationBed()
    const tool: RegisteredTool<unknown, unknown> = {
      name: 'searchInfoEntries',
      description: '检索',
      risk: 'read',
      parse: () => ok({}),
      execute: async () => ({ changeIds: ['change-1'], revisionId: 'revision-1' }),
    }
    const { conversation, message } = await prepared(bed, tool)

    const outcome = await executeToolCall(
      {
        registry: registryOf([tool]),
        invocations: bed.invocations,
        clock: bed.clock,
        ids: bed.ids,
        emit: bed.emit,
        secrets: [],
        toolTimeoutMs: 1000,
      },
      {
        runId: asAgentRunId('run-1'),
        message,
        toolName: tool.name,
        argsJson: '{}',
        context: contextOf(bed, conversation.id),
      },
    )

    expect(outcome.status).toBe('ok')
    expect(outcome.metadata).toMatchObject({
      changeIds: ['change-1'],
      revisionId: 'revision-1',
      resumeId: null,
    })
    expect(outcome.invocationId).not.toBeNull()
    await expect(bed.invocations.listByRun(asAgentRunId('run-1'))).resolves.toHaveLength(1)
    expect(bed.events.map((event) => event.type)).toEqual(['toolStart', 'toolEnd', 'changeRecorded'])
  })

  it('refuses an unknown tool without writing an invocation row', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const message = aUserMessage(conversation.id)

    const outcome = await executeToolCall(
      {
        registry: buildToolRegistry(),
        invocations: bed.invocations,
        clock: bed.clock,
        ids: bed.ids,
        emit: bed.emit,
        secrets: [],
        toolTimeoutMs: 1000,
      },
      {
        runId: asAgentRunId('run-1'),
        message,
        toolName: 'nope',
        argsJson: '{}',
        context: contextOf(bed, conversation.id),
      },
    )

    expect(outcome.status).toBe('failed')
    expect(outcome.invocationId).toBeNull()
    expect(bed.events.map((event) => event.type)).toEqual(['toolStart', 'toolEnd'])
  })

  it('reports a malformed argument list as a failed call', async () => {
    const bed = createConversationBed()
    const tool: RegisteredTool<unknown, unknown> = {
      name: 'searchInfoEntries',
      description: '检索',
      risk: 'read',
      parse: () => err(new Error('keyword: expected a string')),
      execute: async () => ({}),
    }
    const { conversation, message } = await prepared(bed, tool)

    const outcome = await executeToolCall(
      {
        registry: registryOf([tool]),
        invocations: bed.invocations,
        clock: bed.clock,
        ids: bed.ids,
        emit: bed.emit,
        secrets: [],
        toolTimeoutMs: 1000,
      },
      {
        runId: asAgentRunId('run-1'),
        message,
        toolName: tool.name,
        argsJson: '{"keyword":42}',
        context: contextOf(bed, conversation.id),
      },
    )

    expect(outcome.status).toBe('failed')
    expect(outcome.content).toContain('expected a string')
    const [invocation] = await bed.invocations.listByRun(asAgentRunId('run-1'))
    expect(invocation?.status).toBe('failed')
  })
})

describe('redaction and previews', () => {
  it('scrubs a literal secret and a JSON-escaped one', () => {
    const secret = 'sk-live-do-not-store'
    expect(redactSecret(`key=${secret}`, [secret])).toBe('key=[redacted]')
    const escaped = JSON.stringify({ key: secret }).replace('s', '\\u0073')
    expect(redactJsonSecrets(escaped, [secret])).not.toContain(secret)
  })

  it('folds long arguments and scrubs them', () => {
    const summary = summarizeToolArgs(
      JSON.stringify({ keyword: 'k'.repeat(200), ids: [1, 2, 3, 4, 5, 6], token: 'secret-value' }),
      ['secret-value'],
    )
    expect([...summary].length).toBeLessThanOrEqual(400)
    expect(summary).not.toContain('secret-value')
    expect(summary).toContain('…共 6 项')
  })

  it('reads outcome identifiers by name and ignores malformed values', () => {
    expect(
      readToolOutcomeMetadata({ changeId: 'change-1', revisionId: 'revision-1', resumeId: 'resume-1' }),
    ).toEqual({
      changeIds: ['change-1'],
      revisionId: 'revision-1',
      resumeId: 'resume-1',
    })
    expect(readToolOutcomeMetadata({ resumeId: 42 })).toEqual(EMPTY_TOOL_OUTCOME)
    expect(readToolOutcomeMetadata('text')).toEqual(EMPTY_TOOL_OUTCOME)
  })

  it('wraps and truncates a tool result', () => {
    expect(JSON.parse(successResultJson({ hits: 1 }))).toEqual({ ok: true, value: { hits: 1 } })
    expect([...truncateToolResult('x'.repeat(9000))]).toHaveLength(8000)
    expect(summarizeToolOutcome('x'.repeat(500)).length).toBe(400)
  })
})

describe('reusing a stored user message', () => {
  it('does not append a second user message when reusing the stored one', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const user = await appendMessage(appendDeps(bed), {
      conversationId: conversation.id,
      kind: 'user',
      markdown: '重复利用我',
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '好。' }] })

    await runAgentTurn(turnDeps(bed), {
      conversationId: conversation.id,
      userMessage: {
        conversationId: conversation.id,
        kind: 'user',
        markdown: '重复利用我',
      },
      existingUserMessageId: user.id,
      model: null,
      activeResumeId: null,
    })

    const messages = await bed.messages.listByConversation(conversation.id, 10)
    expect(messages.filter((message) => message.kind === 'user')).toHaveLength(1)
  })
})
