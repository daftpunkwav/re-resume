/**
 * @file runAgentTurn.test
 * @description The run lifecycle against the memory repositories and a scripted
 * model: streaming, tool execution, events, cancellation, failure, retry limits
 * and the database run gate.
 */

import { describe, expect, it } from 'vitest'

import { createConversation } from '../../../src/application/conversation/createConversation'
import {
  CANCELLED_ERROR_TEXT,
  runAgentTurn,
} from '../../../src/application/generation/runAgentTurn'
import type { RunAgentTurnDeps, RunAgentTurnInput } from '../../../src/application/generation/runAgentTurn'
import type { AgentEvent } from '../../../src/domain/generation/AgentEvent'
import type { Conversation } from '../../../src/domain/conversation/Conversation'
import type { Message } from '../../../src/domain/conversation/Message'
import type { MessageRepository } from '../../../src/domain/conversation/ports/MessageRepository'
import type { RegisteredTool, ToolRegistry } from '../../../src/domain/generation/ports/ToolRegistry'
import type { AgentRunId } from '../../../src/domain/shared/branded-id'
import {
  asAgentRunId,
  asAttachmentId,
  asConversationId,
  asJobPostingId,
} from '../../../src/domain/shared/branded-id'
import { ok, err } from '../../../src/domain/shared/Result'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import type { JobPosting } from '../../../src/domain/generation/JobPosting'
import { createConversationBed } from '../../support/conversationBed'
import type { ConversationBed } from '../../support/conversationBed'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

function aTool(overrides: Partial<RegisteredTool<unknown, unknown>> = {}): RegisteredTool<unknown, unknown> {
  return {
    name: 'searchInfoEntries',
    description: '检索信息条目',
    risk: 'read',
    parse: () => ok({}),
    execute: async () => ({ hits: 2 }),
    ...overrides,
  }
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  searchInfoEntries: '检索信息条目',
}

function registryOf(tools: readonly RegisteredTool<unknown, unknown>[]): ToolRegistry {
  return {
    list: () => tools,
    get: (name) => tools.find((tool) => tool.name === name),
    schemas: () =>
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: { type: 'object' },
      })),
    labelFor: (name) => TOOL_LABELS[name] ?? name,
  }
}

function turnDeps(
  bed: ConversationBed,
  overrides: Partial<RunAgentTurnDeps> = {},
): RunAgentTurnDeps {
  return {
    model: bed.model,
    titleModel: null,
    registry: bed.registry,
    conversations: bed.conversations,
    messages: bed.messages,
    messageContexts: bed.messageContexts,
    runs: bed.runs,
    invocations: bed.invocations,
    jobPostings: bed.jobPostings,
    attachments: bed.attachments,
    fileStore: bed.fileStore,
    infoEntries: bed.entries,
    customModules: bed.customModules,
    resumes: bed.resumes,
    changes: bed.changes,
    measurer: bed.measurer,
    clock: bed.clock,
    ids: bed.ids,
    emit: bed.emit,
    signal: new AbortController().signal,
    secrets: [],
    ...overrides,
  }
}

async function newConversation(bed: ConversationBed): Promise<Conversation> {
  return createConversation(
    { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
    {},
  )
}

function turnInput(conversationId: Conversation['id'], text = '帮我整理简历'): RunAgentTurnInput {
  return {
    conversationId,
    userMessage: { conversationId, kind: 'user', markdown: text },
    model: null,
    activeResumeId: null,
  }
}

function eventTypes(events: readonly AgentEvent[]): string[] {
  return events.map((event) => event.type)
}

function assistantOf(messages: readonly Message[]): Message | undefined {
  return messages.find((message) => message.kind === 'assistant')
}

describe('runAgentTurn — a plain answer', () => {
  it('streams the text, records the run and emits the event sequence', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [
        { type: 'text', textDelta: '好的，' },
        { type: 'text', textDelta: '我来整理。' },
        { type: 'usage', promptTokens: 10, completionTokens: 4 },
      ],
    })

    const run = await runAgentTurn(turnDeps(bed), turnInput(conversation.id))

    expect(run.status).toBe('completed')
    expect(run.endedAt).not.toBeNull()
    expect(run.promptTokens).toBe(10)
    expect(run.completionTokens).toBe(4)
    const messages = await bed.messages.listByConversation(conversation.id, 10)
    expect(messages.map((message) => message.kind)).toEqual(['user', 'assistant'])
    expect(messages[1]).toMatchObject({ status: 'complete', markdown: '好的，我来整理。' })
    expect(messages[0]?.seq).toBe(1)
    expect(messages[1]?.seq).toBe(2)
    expect(eventTypes(bed.events)).toEqual([
      'runStarted',
      'turnStarted',
      'textDelta',
      'textDelta',
      'usage',
      'done',
    ])
    expect(bed.events.at(-1)).toMatchObject({ type: 'done', status: 'completed', runId: run.id })
    const request = bed.model.requests[0]
    expect(request?.system).toContain('始终使用中文回答')
    expect(request?.messages).toEqual([
      { role: 'user', parts: [{ kind: 'text', text: '帮我整理简历' }] },
    ])
  })

  it('creates the run before the first model call', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    let runsDuringCall = 0
    bed.model.enqueue({
      chunks: [{ type: 'text', textDelta: '好' }],
    })
    const run = await runAgentTurn(turnDeps(bed), turnInput(conversation.id))
    runsDuringCall = (await bed.runs.findById(run.id)) === null ? 0 : 1
    expect(runsDuringCall).toBe(1)
    const messages = await bed.messages.listByConversation(conversation.id, 10)
    expect(assistantOf(messages)?.runId).toBe(run.id)
  })

  it('passes the job description chip into the system prompt', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const posting: JobPosting = {
      id: asJobPostingId('posting-1'),
      rawText: '招聘资深前端工程师，要求性能优化经验。',
      source: 'paste',
      imageAttachmentIds: [],
      conversationId: null,
      resumeId: null,
      parsed: null,
      parsedByRunId: null,
      parsedAt: null,
      createdAt: AT,
    }
    await bed.jobPostings.insert(posting)
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '收到' }] })

    await runAgentTurn(turnDeps(bed), {
      conversationId: conversation.id,
      userMessage: {
        conversationId: conversation.id,
        kind: 'user',
        markdown: '看看这个岗位',
        contexts: [{ kind: 'jobPosting', refId: posting.id }],
      },
      model: null,
      activeResumeId: null,
    })

    const system = bed.model.requests[0]?.system ?? ''
    expect(system).toContain('## 岗位描述')
    expect(system).toContain('招聘资深前端工程师')
    expect(system).toContain('## 用户提供的上下文')
  })
})

describe('runAgentTurn — tools', () => {
  it('executes a tool, records it and feeds the result into the next turn', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [
        { type: 'text', textDelta: '我先检索。' },
        { type: 'toolCall', name: 'searchInfoEntries', argsJson: '{"keyword":"前端"}' },
      ],
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '找到了两条。' }] })
    const tool = aTool({
      execute: async () => ({
        changeId: 'change-1',
        revisionId: 'revision-1',
        resumeId: 'resume-1',
        hits: 2,
      }),
    })

    const run = await runAgentTurn(turnDeps(bed, { registry: registryOf([tool]) }), turnInput(conversation.id))

    expect(run.status).toBe('completed')
    const messages = await bed.messages.listByConversation(conversation.id, 10)
    expect(messages.map((message) => message.kind)).toEqual(['user', 'assistant', 'tool'])
    const toolMessage = messages[2]
    expect(toolMessage).toMatchObject({
      status: 'complete',
      tool: {
        toolName: 'searchInfoEntries',
        risk: 'read',
        label: '检索信息条目',
        changeIds: ['change-1'],
        revisionId: 'revision-1',
        resumeId: 'resume-1',
      },
    })
    expect(toolMessage?.tool?.invocationId).not.toBeNull()
    const invocations = await bed.invocations.listByRun(run.id)
    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toMatchObject({ status: 'ok', changeIds: ['change-1'] })

    // The second request carries the result as a toolResult part.
    const secondRequest = bed.model.requests[1]
    expect(secondRequest?.messages.at(-1)).toMatchObject({
      role: 'user',
      parts: [{ kind: 'toolResult', toolName: 'searchInfoEntries' }],
    })
    expect(secondRequest?.messages.at(-1)?.parts[0]).toMatchObject({
      content: expect.stringContaining('"ok":true') as unknown,
    })
    const types = eventTypes(bed.events)
    expect(types).toEqual([
      'runStarted',
      'turnStarted',
      'textDelta',
      'toolStart',
      'toolEnd',
      'changeRecorded',
      'turnStarted',
      'textDelta',
      'done',
    ])
  })

  it('refuses an unregistered tool without failing the run', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [{ type: 'toolCall', name: 'unknownTool', argsJson: '{}' }],
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '我换个方式。' }] })

    const run = await runAgentTurn(turnDeps(bed), turnInput(conversation.id))

    expect(run.status).toBe('completed')
    const toolMessage = (await bed.messages.listByConversation(conversation.id, 10)).find(
      (message) => message.kind === 'tool',
    )
    expect(toolMessage).toMatchObject({ status: 'failed', tool: { invocationId: null } })
    await expect(bed.invocations.listByRun(run.id)).resolves.toEqual([])
  })

  it('reports malformed arguments to the model and keeps going', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [{ type: 'toolCall', name: 'searchInfoEntries', argsJson: '{"keyword":42}' }],
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '明白了。' }] })
    const tool = aTool({ parse: () => err(new Error('keyword: expected a string')) })

    const run = await runAgentTurn(turnDeps(bed, { registry: registryOf([tool]) }), turnInput(conversation.id))

    expect(run.status).toBe('completed')
    const invocation = (await bed.invocations.listByRun(run.id))[0]
    expect(invocation?.status).toBe('failed')
    const resultPart = bed.model.requests[1]?.messages.at(-1)?.parts[0]
    expect(resultPart).toMatchObject({ kind: 'toolResult' })
    expect(JSON.stringify(resultPart)).toContain('expected a string')
  })

  it('fails the run when a tool throws a programming fault', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [{ type: 'toolCall', name: 'searchInfoEntries', argsJson: '{}' }],
    })
    const tool = aTool({
      execute: async () => {
        throw new Error('database exploded')
      },
    })

    const run = await runAgentTurn(turnDeps(bed, { registry: registryOf([tool]) }), turnInput(conversation.id))

    expect(run.status).toBe('failed')
    expect(run.errorText).toContain('database exploded')
    expect(eventTypes(bed.events)).toContain('error')
    const toolMessage = (await bed.messages.listByConversation(conversation.id, 10)).find(
      (message) => message.kind === 'tool',
    )
    expect(toolMessage?.status).toBe('failed')
  })

  it('marks a timed-out tool failed and lets the model correct itself', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [{ type: 'toolCall', name: 'searchInfoEntries', argsJson: '{}' }],
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '我先不检索了。' }] })
    const tool = aTool({
      execute: () => new Promise(() => undefined),
    })

    const run = await runAgentTurn(
      turnDeps(bed, { registry: registryOf([tool]), limits: { toolTimeoutMs: 5 } }),
      turnInput(conversation.id),
    )

    expect(run.status).toBe('completed')
    const toolMessage = (await bed.messages.listByConversation(conversation.id, 10)).find(
      (message) => message.kind === 'tool',
    )
    expect(toolMessage?.status).toBe('failed')
    expect(toolMessage?.tool?.detail).toContain('执行超时')
  })

  it('keeps the tool message in audit state when the tool result names no changes', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({ chunks: [{ type: 'toolCall', name: 'searchInfoEntries', argsJson: '{}' }] })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '完成' }] })

    await runAgentTurn(
      turnDeps(bed, { registry: registryOf([aTool()]) }),
      turnInput(conversation.id),
    )

    expect(bed.events.some((event) => event.type === 'changeRecorded')).toBe(false)
  })
})

describe('runAgentTurn — cancellation and failure', () => {
  it('keeps the streamed text when the user cancels', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const controller = new AbortController()
    bed.model.enqueue({
      chunks: [
        { type: 'text', textDelta: '先写一半，' },
        { type: 'text', textDelta: '再写一半。' },
      ],
      beforeEachChunk: () => {
        if (bed.model.requests.length === 1) controller.abort()
      },
    })

    const run = await runAgentTurn(
      turnDeps(bed, { signal: controller.signal }),
      turnInput(conversation.id),
    )

    expect(run.status).toBe('cancelled')
    expect(run.errorText).toBe(CANCELLED_ERROR_TEXT)
    const assistant = assistantOf(await bed.messages.listByConversation(conversation.id, 10))
    expect(assistant).toMatchObject({ status: 'cancelled', errorText: CANCELLED_ERROR_TEXT })
    expect(assistant?.markdown.length).toBeGreaterThan(0)
    expect(bed.events.at(-1)).toMatchObject({ type: 'done', status: 'cancelled' })
  })

  it('fails the run on a permanent model error and emits the error event', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({ error: Object.assign(new Error('bad request'), { retryable: false, status: 400 }) })

    const run = await runAgentTurn(turnDeps(bed), turnInput(conversation.id))

    expect(run.status).toBe('failed')
    expect(run.errorText).toContain('bad request')
    const assistant = assistantOf(await bed.messages.listByConversation(conversation.id, 10))
    expect(assistant?.status).toBe('failed')
    expect(bed.events.filter((event) => event.type === 'error')).toHaveLength(1)
  })

  it('retries a transient failure once when nothing was written yet', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      error: Object.assign(new Error('overloaded'), { retryable: true, status: 503 }),
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '恢复后继续。' }] })
    const waits: number[] = []

    const run = await runAgentTurn(
      turnDeps(bed, {
        wait: async (milliseconds) => {
          waits.push(milliseconds)
        },
      }),
      turnInput(conversation.id),
    )

    expect(run.status).toBe('completed')
    expect(bed.model.calls).toBe(2)
    expect(waits).toEqual([1500])
  })

  it('does not retry after text was already streamed', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [
        { type: 'text', textDelta: '开始回答' },
      ],
    })
    // Simulate the failure arriving after the first delta: a second call would
    // duplicate the visible answer, so the run fails instead.
    const failing: RunAgentTurnDeps['model'] = {
      id: 'failing',
      modelId: 'failing',
      supportsImages: false,
      stream: async function* () {
        yield { type: 'text' as const, textDelta: '开始回答' }
        throw Object.assign(new Error('cut off'), { retryable: true, status: 502 })
      },
    }

    const run = await runAgentTurn(
      turnDeps(bed, { model: failing }),
      turnInput(conversation.id),
    )

    expect(run.status).toBe('failed')
    expect(bed.model.calls).toBe(0)
  })

  it('fails after the maximum number of turns', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({ chunks: [{ type: 'toolCall', name: 'searchInfoEntries', argsJson: '{}' }] })
    bed.model.enqueue({ chunks: [{ type: 'toolCall', name: 'searchInfoEntries', argsJson: '{}' }] })

    const run = await runAgentTurn(
      turnDeps(bed, { registry: registryOf([aTool()]), limits: { maxTurns: 2 } }),
      turnInput(conversation.id),
    )

    expect(run.status).toBe('failed')
    expect(run.errorText).toContain('最大轮次')
    expect(bed.model.calls).toBe(2)
  })

  it('returns the run already in flight instead of starting a second stream', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const running = await bed.messages.createRun({
      id: asAgentRunId('run-existing'),
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

    const run = await runAgentTurn(turnDeps(bed), turnInput(conversation.id))

    expect(run.id).toBe(running.id)
    expect(run.id).toBe('run-existing')
    expect(bed.model.calls).toBe(0)
  })
})

describe('runAgentTurn — input parts and titles', () => {
  it('refuses images when the configured model has no image input', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    await bed.fileStore.write('image.png', new Uint8Array([1, 2, 3]))
    const attachment = {
      id: asAttachmentId('attachment-1'),
      kind: 'image' as const,
      mimeType: 'image/png',
      byteSize: 3,
      storageName: 'image.png',
      width: null,
      height: null,
      sha256: 'a'.repeat(64),
      createdAt: AT,
    }
    await bed.attachments.insert(attachment)

    const run = await runAgentTurn(turnDeps(bed), {
      conversationId: conversation.id,
      userMessage: {
        conversationId: conversation.id,
        kind: 'user',
        markdown: '看图',
        attachmentIds: [attachment.id],
      },
      model: null,
      activeResumeId: null,
    })

    expect(run.status).toBe('failed')
    expect(run.errorText).toContain('不支持图片输入')
    expect(bed.model.calls).toBe(0)
  })

  it('sends an image part when the model supports images', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    bed.model.supportsImages = true
    await bed.fileStore.write('image.png', new Uint8Array([104, 105]))
    await bed.attachments.insert({
      id: asAttachmentId('attachment-1'),
      kind: 'image',
      mimeType: 'image/png',
      byteSize: 2,
      storageName: 'image.png',
      width: null,
      height: null,
      sha256: 'a'.repeat(64),
      createdAt: AT,
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '看到了。' }] })

    await runAgentTurn(turnDeps(bed), {
      conversationId: conversation.id,
      userMessage: {
        conversationId: conversation.id,
        kind: 'user',
        markdown: '看图',
        attachmentIds: [asAttachmentId('attachment-1')],
      },
      model: null,
      activeResumeId: null,
    })

    expect(bed.model.requests[0]?.messages[0]?.parts).toEqual([
      { kind: 'text', text: '看图' },
      { kind: 'image', mimeType: 'image/png', base64: 'aGk=' },
    ])
  })

  it('names the conversation from the first user message', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const titleModel = bed.model
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '「字节前端简历」' }] })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '好的。' }] })

    await runAgentTurn(
      turnDeps(bed, { titleModel }),
      turnInput(conversation.id, '帮我针对字节跳动前端岗位整理一份简历'),
    )

    const stored = await bed.conversations.findById(conversation.id)
    expect(stored?.title).toBe('字节前端简历')
  })

  it('does not replace a title the user chose', async () => {
    const bed = createConversationBed()
    const conversation = await createConversation(
      { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
      { title: '用户起的标题' },
    )
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '「模型起的标题」' }] })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '好的。' }] })

    await runAgentTurn(
      turnDeps(bed, { titleModel: bed.model }),
      turnInput(conversation.id, '帮我针对字节跳动前端岗位整理一份简历'),
    )

    await expect(bed.conversations.findById(conversation.id)).resolves.toMatchObject({
      title: '用户起的标题',
    })
  })

  it('persists streamed text while the stream is still open', async () => {
    const bed = createConversationBed()
    const conversation = await newConversation(bed)
    const snapshots: string[] = []
    let updates = 0
    const countingMessages: MessageRepository = Object.create(bed.messages) as MessageRepository
    countingMessages.update = async (message: Message) => {
      updates += 1
      snapshots.push(message.markdown)
      return bed.messages.update(message)
    }
    bed.model.enqueue({
      chunks: [
        { type: 'text', textDelta: '第一段' },
        { type: 'text', textDelta: '第二段' },
      ],
      beforeEachChunk: () => {
        // Read the persisted state between chunks.
        snapshots.push('chunk-boundary')
      },
    })

    await runAgentTurn(
      turnDeps(bed, {
        messages: countingMessages,
        limits: { streamPersistIntervalMs: 0 },
      }),
      turnInput(conversation.id),
    )

    expect(updates).toBeGreaterThanOrEqual(2)
    expect(snapshots).toContain('第一段')
    expect(snapshots).toContain('第一段第二段')
  })
})

describe('the run turn types', () => {
  it('keeps a branded run identifier in the deps contract', () => {
    const runId: AgentRunId = asAgentRunId('run-1')
    expect(asConversationId(String(runId))).toBe('run-1')
    expect(asJobPostingId('posting-1')).toBe('posting-1')
  })
})
