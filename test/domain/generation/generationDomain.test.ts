/**
 * @file generationDomain.test
 * @description The run and tool-invocation shapes, the job-posting provenance
 * rule and the port's error contract.
 */

import { describe, expect, it } from 'vitest'

import {
  cancelAgentRun,
  completeRun,
  failRun,
  isAgentRunStatus,
  isTerminalRunStatus,
  recordRunUsage,
} from '../../../src/domain/generation/AgentRun'
import type { AgentRun } from '../../../src/domain/generation/AgentRun'
import { attachParse, hasJobPostingContent } from '../../../src/domain/generation/JobPosting'
import type { JobPosting } from '../../../src/domain/generation/JobPosting'
import { isToolInvocationStatus } from '../../../src/domain/generation/ToolInvocation'
import { isToolRisk } from '../../../src/domain/generation/ToolRisk'
import { readModelCallFailure } from '../../../src/domain/generation/ports/ModelProvider'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  asAgentRunId,
  asConversationId,
  asJobPostingId,
} from '../../../src/domain/shared/branded-id'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const LATER: DateTime = parseDateTime('2026-01-01T00:00:05.000Z') as DateTime

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

describe('agent runs', () => {
  it('ends a running run in exactly one terminal state', () => {
    const run = aRun()
    expect(isTerminalRunStatus(run.status)).toBe(false)
    expect(completeRun(run, LATER)).toMatchObject({ status: 'completed', endedAt: LATER, errorText: null })
    expect(failRun(run, '失败', LATER)).toMatchObject({ status: 'failed', errorText: '失败' })
    expect(cancelAgentRun(run, LATER)).toMatchObject({ status: 'cancelled', errorText: '已取消' })
    expect(isTerminalRunStatus('completed')).toBe(true)
    expect(isAgentRunStatus('awaitingConfirmation')).toBe(false)
    expect(isAgentRunStatus('running')).toBe(true)
  })

  it('accumulates usage across provider calls', () => {
    const once = recordRunUsage(aRun(), { promptTokens: 10, completionTokens: 5 })
    const twice = recordRunUsage(once, { promptTokens: 20, completionTokens: 7 })
    expect(twice.promptTokens).toBe(30)
    expect(twice.completionTokens).toBe(12)
  })
})

describe('tool vocabulary', () => {
  it('accepts exactly read, write and draft', () => {
    expect(isToolRisk('read')).toBe(true)
    expect(isToolRisk('draft')).toBe(true)
    expect(isToolRisk('destructive')).toBe(false)
    expect(isToolInvocationStatus('ok')).toBe(true)
    expect(isToolInvocationStatus('running')).toBe(false)
  })
})

describe('job postings', () => {
  it('has content when it carries text or images', () => {
    expect(hasJobPostingContent(aPosting())).toBe(true)
    expect(hasJobPostingContent(aPosting({ rawText: '', imageAttachmentIds: [] }))).toBe(false)
  })

  it('records the run and instant that produced the parse', () => {
    const parsed = attachParse(
      aPosting(),
      {
        title: '前端工程师',
        company: null,
        responsibilities: [],
        requirements: [],
        keywords: [],
      },
      asAgentRunId('run-1'),
      LATER,
    )
    expect(parsed.parsedByRunId).toBe('run-1')
    expect(parsed.parsedAt).toBe(LATER)
  })
})

describe('the model failure contract', () => {
  it('reads retryability from an adapter error and ignores anything else', () => {
    class ModelLikeError extends Error {
      readonly retryable = true
      readonly status = 503
      readonly detail = 'busy'
    }
    expect(readModelCallFailure(new ModelLikeError('busy'))).toEqual({
      retryable: true,
      status: 503,
      detail: 'busy',
    })
    expect(readModelCallFailure(new Error('plain'))).toBeNull()
    expect(readModelCallFailure('text')).toBeNull()
    expect(readModelCallFailure({ retryable: 'yes' })).toBeNull()
  })
})
