/**
 * @file toolIntegration.test
 * @description The tool pack inside the real run loop: the event order, the
 * audit row and card metadata of a tool call, the prompt blocks the context now
 * carries, and the mapping of a domain refusal into the next turn's result.
 */

import { describe, expect, it } from 'vitest'

import { createConversation } from '../../../../src/application/conversation/createConversation'
import { createResume } from '../../../../src/application/resume/createResume'
import { runAgentTurn } from '../../../../src/application/generation/runAgentTurn'
import type { RunAgentTurnDeps } from '../../../../src/application/generation/runAgentTurn'
import type { Conversation } from '../../../../src/domain/conversation/Conversation'
import type { Message } from '../../../../src/domain/conversation/Message'
import { createToolBed } from '../../../support/toolBed'
import type { ToolBed } from '../../../support/toolBed'

function turnDeps(bed: ToolBed): RunAgentTurnDeps {
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
    emit: (event) => {
      bed.events.push(event)
    },
    signal: new AbortController().signal,
    secrets: [],
  }
}

async function newConversation(bed: ToolBed): Promise<Conversation> {
  return createConversation(
    { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
    {},
  )
}

function toolMessageOf(messages: readonly Message[]): Message | undefined {
  return messages.find((message) => message.kind === 'tool')
}

function assistantTextOf(messages: readonly Message[]): Message | undefined {
  return messages.find((message) => message.kind === 'assistant')
}

describe('a tool call inside the run loop', () => {
  it('creates a resume, records the invocation and emits the audit events', async () => {
    const bed = createToolBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [
        {
          type: 'toolCall',
          name: 'createResume',
          argsJson: JSON.stringify({
            title: '后端开发工程师简历',
            selection: [{ moduleKind: 'skill', entryIds: ['preview-skill-1'] }],
          }),
        },
      ],
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '简历已创建。' }] })

    const run = await runAgentTurn(turnDeps(bed), {
      conversationId: conversation.id,
      userMessage: { conversationId: conversation.id, kind: 'user', markdown: '帮我建一份简历' },
      model: null,
      activeResumeId: null,
    })

    expect(run.status).toBe('completed')
    expect(bed.events.map((event) => event.type)).toEqual([
      'runStarted',
      'turnStarted',
      'toolStart',
      'toolEnd',
      'changeRecorded',
      'turnStarted',
      'textDelta',
      'done',
    ])
    const messages = await bed.messages.listByConversation(conversation.id, 10)
    const toolMessage = toolMessageOf(messages)
    expect(toolMessage).toMatchObject({
      kind: 'tool',
      status: 'complete',
      tool: { toolName: 'createResume', risk: 'write', label: '创建简历' },
    })
    expect(toolMessage?.tool?.revisionId).not.toBeNull()
    expect(toolMessage?.tool?.resumeId).not.toBeNull()
    expect(assistantTextOf(messages)?.markdown).toBe('简历已创建。')

    const invocations = await bed.invocations.listByRun(run.id)
    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toMatchObject({
      toolName: 'createResume',
      status: 'ok',
      changeIds: [],
    })
    expect(invocations[0]?.revisionId).toBe(toolMessage?.tool?.revisionId)
    const created = await bed.resumes.listAll()
    expect(created.some((resume) => resume.title === '后端开发工程师简历')).toBe(true)
  })

  it('feeds a domain refusal back to the model and keeps the run alive', async () => {
    const bed = createToolBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [
        {
          type: 'toolCall',
          name: 'createInfoEntry',
          argsJson: JSON.stringify({ moduleKind: 'skill', fields: {} }),
        },
      ],
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '缺少必填字段，我换一种方式。' }] })

    const run = await runAgentTurn(turnDeps(bed), {
      conversationId: conversation.id,
      userMessage: { conversationId: conversation.id, kind: 'user', markdown: '加一条技能' },
      model: null,
      activeResumeId: null,
    })

    expect(run.status).toBe('completed')
    const toolMessage = toolMessageOf(await bed.messages.listByConversation(conversation.id, 10))
    expect(toolMessage?.status).toBe('failed')
    const secondRequest = bed.model.requests[1]
    const resultPart = secondRequest?.messages.at(-1)?.parts[0]
    expect(JSON.stringify(resultPart)).toContain('blankRequiredField')
  })

  it('reports the change record of a library write as undoable metadata', async () => {
    const bed = createToolBed()
    const conversation = await newConversation(bed)
    bed.model.enqueue({
      chunks: [
        {
          type: 'toolCall',
          name: 'createInfoEntry',
          argsJson: JSON.stringify({ moduleKind: 'skill', fields: { name: 'Rust' } }),
        },
      ],
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '已记录。' }] })

    const run = await runAgentTurn(turnDeps(bed), {
      conversationId: conversation.id,
      userMessage: { conversationId: conversation.id, kind: 'user', markdown: '记一条 Rust' },
      model: null,
      activeResumeId: null,
    })

    const toolMessage = toolMessageOf(await bed.messages.listByConversation(conversation.id, 10))
    expect(toolMessage?.tool?.changeIds).toHaveLength(1)
    const changeId = toolMessage?.tool?.changeIds[0] as never
    const record = await bed.changes.findById(changeId)
    expect(record).toMatchObject({ origin: 'agent', conversationId: conversation.id })
    expect(record?.runId).toBe(run.id)
    expect(bed.events.map((event) => event.type)).toContain('changeRecorded')
  })
})

describe('the assembled prompt', () => {
  it('carries the current resume and the library overview', async () => {
    const bed = createToolBed()
    const conversation = await newConversation(bed)
    await createResume(
      { resumes: bed.resumes, entries: bed.entries, ids: bed.ids, clock: bed.clock },
      {
        title: '后端开发工程师简历',
        conversationId: conversation.id,
        initialSelection: [
          { moduleKind: 'personal', customModuleId: null, entryIds: ['preview-personal-1' as never] },
          { moduleKind: 'project', customModuleId: null, entryIds: ['preview-project-1' as never] },
        ],
        origin: 'user',
        runId: null,
      },
    )
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '好的。' }] })

    await runAgentTurn(turnDeps(bed), {
      conversationId: conversation.id,
      userMessage: { conversationId: conversation.id, kind: 'user', markdown: '看看现在的简历' },
      model: null,
      activeResumeId: null,
    })

    const system = bed.model.requests[0]?.system ?? ''
    expect(system).toContain('## 当前简历')
    expect(system).toContain('后端开发工程师简历')
    expect(system).toContain('订单中台重构')
    expect(system).toContain('## 信息库概览')
    expect(system).toContain('个人信息')
  })
})
