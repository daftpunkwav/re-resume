/**
 * @file runStore.test
 * @description The reducer of the live run: one test per AgentEvent kind, plus
 * the lifecycle a new run clears and a reset drops.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { useRunStore } from '../../../../src/presentation/features/conversation/stores/runStore'
import type { AgentEvent } from '../../../../src/domain/generation/AgentEvent'
import {
  asAgentRunId,
  asChangeRecordId,
  asConversationId,
  asMessageId,
  asResumeId,
  asRevisionId,
  asToolInvocationId,
} from '../../../../src/domain/shared/branded-id'

const CONVERSATION = asConversationId('conversation-1')
const RUN = asAgentRunId('run-1')
const USER_MESSAGE = asMessageId('message-user')
const ASSISTANT_MESSAGE = asMessageId('message-assistant')
const TOOL_MESSAGE = asMessageId('message-tool')
const INVOCATION = asToolInvocationId('invocation-1')

function apply(event: AgentEvent): void {
  useRunStore.getState().applyEvent(event)
}

describe('runStore', () => {
  beforeEach(() => {
    useRunStore.getState().reset()
  })

  it('tracks a run from its first event to its text buffer', () => {
    useRunStore.getState().begin(CONVERSATION)
    apply({
      type: 'runStarted',
      runId: RUN,
      conversationId: CONVERSATION,
      userMessageId: USER_MESSAGE,
      assistantMessageId: ASSISTANT_MESSAGE,
    })
    apply({ type: 'textDelta', messageId: ASSISTANT_MESSAGE, delta: '第一段' })
    apply({ type: 'textDelta', messageId: ASSISTANT_MESSAGE, delta: '，第二段' })
    apply({ type: 'turnStarted', turn: 2 })

    const state = useRunStore.getState()
    expect(state.status).toBe('running')
    expect(state.started).toBe(true)
    expect(state.runId).toBe(RUN)
    expect(state.assistantMessageId).toBe(ASSISTANT_MESSAGE)
    expect(state.buffer).toBe('第一段，第二段')
    expect(state.turn).toBe(2)
  })

  it('tracks a tool call from running to its outcome', () => {
    useRunStore.getState().begin(CONVERSATION)
    apply({
      type: 'runStarted',
      runId: RUN,
      conversationId: CONVERSATION,
      userMessageId: USER_MESSAGE,
      assistantMessageId: ASSISTANT_MESSAGE,
    })
    apply({
      type: 'toolStart',
      invocationId: INVOCATION,
      toolName: 'searchInfoEntries',
      risk: 'read',
      label: '检索信息条目',
      argsSummary: '{"keyword":"前端"}',
      messageId: TOOL_MESSAGE,
    })

    const running = useRunStore.getState().toolCards[INVOCATION]
    expect(running).toMatchObject({ status: 'running', label: '检索信息条目' })

    apply({
      type: 'toolEnd',
      invocationId: INVOCATION,
      status: 'ok',
      summary: '命中 3 条',
      messageId: TOOL_MESSAGE,
      changeIds: [asChangeRecordId('change-1')],
      revisionId: asRevisionId('revision-1'),
      resumeId: asResumeId('resume-1'),
    })

    expect(useRunStore.getState().toolCards[INVOCATION]).toMatchObject({
      status: 'ok',
      summary: '命中 3 条',
      changeIds: ['change-1'],
      revisionId: 'revision-1',
      resumeId: 'resume-1',
    })
  })

  it('ignores a tool outcome for an invocation it never saw', () => {
    useRunStore.getState().begin(CONVERSATION)
    apply({
      type: 'toolEnd',
      invocationId: INVOCATION,
      status: 'failed',
      summary: '失败',
      messageId: TOOL_MESSAGE,
      changeIds: [],
      revisionId: null,
      resumeId: null,
    })

    expect(useRunStore.getState().toolCards).toEqual({})
  })

  it('records token usage against the streaming answer', () => {
    useRunStore.getState().begin(CONVERSATION)
    apply({
      type: 'runStarted',
      runId: RUN,
      conversationId: CONVERSATION,
      userMessageId: USER_MESSAGE,
      assistantMessageId: ASSISTANT_MESSAGE,
    })
    apply({ type: 'usage', promptTokens: 120, completionTokens: 86 })

    expect(useRunStore.getState().usageByMessage[ASSISTANT_MESSAGE]).toEqual({
      promptTokens: 120,
      completionTokens: 86,
    })
  })

  it('keeps the failure text and settles on done', () => {
    useRunStore.getState().begin(CONVERSATION)
    apply({
      type: 'runStarted',
      runId: RUN,
      conversationId: CONVERSATION,
      userMessageId: USER_MESSAGE,
      assistantMessageId: ASSISTANT_MESSAGE,
    })
    apply({ type: 'error', message: '模型服务不可用', retryable: true })

    expect(useRunStore.getState().errorText).toBe('模型服务不可用')
    expect(useRunStore.getState().status).toBe('running')

    apply({ type: 'done', status: 'failed', runId: RUN, errorText: '模型服务不可用' })

    expect(useRunStore.getState().status).toBe('idle')
    expect(useRunStore.getState().errorText).toBe('模型服务不可用')
  })

  it('reports a stop request while the stream is still running', () => {
    useRunStore.getState().begin(CONVERSATION)

    useRunStore.getState().markCancelling()
    expect(useRunStore.getState().status).toBe('cancelling')

    apply({ type: 'done', status: 'cancelled', runId: RUN, errorText: '已取消' })
    expect(useRunStore.getState().status).toBe('idle')
  })

  it('clears the previous answer when a new run begins and on reset', () => {
    useRunStore.getState().begin(CONVERSATION)
    apply({
      type: 'runStarted',
      runId: RUN,
      conversationId: CONVERSATION,
      userMessageId: USER_MESSAGE,
      assistantMessageId: ASSISTANT_MESSAGE,
    })
    apply({ type: 'textDelta', messageId: ASSISTANT_MESSAGE, delta: '旧内容' })
    apply({ type: 'usage', promptTokens: 1, completionTokens: 2 })

    useRunStore.getState().begin(CONVERSATION)

    expect(useRunStore.getState().buffer).toBe('')
    expect(useRunStore.getState().started).toBe(false)
    // Usage is kept per message, so the previous answer's footer still reads its
    // token totals after the next run starts.
    expect(useRunStore.getState().usageByMessage[ASSISTANT_MESSAGE]).toBeDefined()

    useRunStore.getState().reset()
    expect(useRunStore.getState()).toMatchObject({
      status: 'idle',
      buffer: '',
      usageByMessage: {},
      toolCards: {},
    })
  })
})
