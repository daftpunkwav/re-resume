import { describe, expect, it } from 'vitest'
import {
  fromAgentRunRow,
  fromToolInvocationRow,
  toAgentRunRow,
  toToolInvocationRow,
} from '../../../src/infrastructure/persistence/mappers/AgentRunRowMapper'
import type {
  AgentRunRow,
  ToolInvocationRow,
} from '../../../src/infrastructure/persistence/mappers/AgentRunRowMapper'
import type { AgentRun } from '../../../src/domain/generation/AgentRun'
import type { ToolInvocation } from '../../../src/domain/generation/ToolInvocation'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  asAgentRunId,
  asJobPostingId,
  asResumeId,
  asToolInvocationId,
} from '../../../src/domain/shared/branded-id'

const STARTED = parseDateTime('2026-03-01T09:00:00.000Z') as DateTime
const ENDED = parseDateTime('2026-03-01T09:05:00.000Z') as DateTime

const RUN: AgentRun = {
  id: asAgentRunId('run-1'),
  resumeId: asResumeId('res-1'),
  jobPostingId: asJobPostingId('job-1'),
  status: 'completed',
  errorText: null,
  startedAt: STARTED,
  endedAt: ENDED,
}

const INVOCATION: ToolInvocation = {
  id: asToolInvocationId('tool-1'),
  runId: asAgentRunId('run-1'),
  toolName: 'searchExperiences',
  risk: 'read',
  argsJson: '{"keyword":"服务拆分"}',
  resultJson: '[{"id":"exp-1"}]',
  approvalState: 'executed',
  createdAt: ENDED,
}

function runRowWith(overrides: Partial<AgentRunRow>): AgentRunRow {
  return { ...toAgentRunRow(RUN), ...overrides }
}

function invocationRowWith(overrides: Partial<ToolInvocationRow>): ToolInvocationRow {
  return { ...toToolInvocationRow(INVOCATION), ...overrides }
}

describe('AgentRunRowMapper', () => {
  it('round-trips a run', () => {
    expect(fromAgentRunRow(toAgentRunRow(RUN))).toEqual(RUN)
  })

  it('round-trips a run with no resume, no posting and no failure', () => {
    const running: AgentRun = {
      ...RUN,
      resumeId: null,
      jobPostingId: null,
      status: 'running',
      endedAt: null,
    }

    expect(fromAgentRunRow(toAgentRunRow(running))).toEqual(running)
  })

  it('round-trips a tool invocation', () => {
    expect(fromToolInvocationRow(toToolInvocationRow(INVOCATION))).toEqual(INVOCATION)
  })

  it('stores the argument document verbatim inside a versioned envelope', () => {
    const row = toToolInvocationRow(INVOCATION)

    expect(JSON.parse(row.args_json)).toEqual({ v: 1, data: '{"keyword":"服务拆分"}' })
    expect(fromToolInvocationRow(row).argsJson).toBe('{"keyword":"服务拆分"}')
  })

  it('keeps a null result as null rather than as an empty envelope', () => {
    const row = toToolInvocationRow({ ...INVOCATION, resultJson: null })

    expect(row.result_json).toBeNull()
    expect(fromToolInvocationRow(row).resultJson).toBeNull()
  })

  it('rejects a run status outside the closed set', () => {
    expect(() => fromAgentRunRow(runRowWith({ status: 'paused' }))).toThrow(/agent_run.status/)
  })

  it('round-trips awaitingConfirmation, which is reserved rather than removed', () => {
    expect(fromAgentRunRow(runRowWith({ status: 'awaitingConfirmation' })).status).toBe(
      'awaitingConfirmation',
    )
  })

  it('rejects a risk level outside the closed set', () => {
    expect(() =>
      fromToolInvocationRow(invocationRowWith({ risk: 'delete-everything' })),
    ).toThrow(/tool_invocation.risk/)
  })

  it('rejects an approval state outside the closed set', () => {
    expect(() =>
      fromToolInvocationRow(invocationRowWith({ approval_state: 'maybe' })),
    ).toThrow(/tool_invocation.approval_state/)
  })

  it('rejects a bare object or array as args_json, which is not an envelope', () => {
    expect(() => fromToolInvocationRow(invocationRowWith({ args_json: '{}' }))).toThrow(
      /envelope version missing/,
    )
    expect(() => fromToolInvocationRow(invocationRowWith({ args_json: '[]' }))).toThrow(
      /not a JSON envelope object/,
    )
  })

  it('rejects an unknown envelope version on an audit column', () => {
    expect(() =>
      fromToolInvocationRow(invocationRowWith({ args_json: '{"v":0,"data":"{}"}' })),
    ).toThrow(/envelope version 0 is not supported/)
  })

  it('rejects an envelope whose payload is not the argument text', () => {
    expect(() =>
      fromToolInvocationRow(invocationRowWith({ args_json: '{"v":1,"data":{"keyword":"x"}}' })),
    ).toThrow(/envelope payload is not a JSON string/)
  })

  it('rejects a timestamp column that is not a timestamp', () => {
    expect(() => fromAgentRunRow(runRowWith({ started_at: '2026-03-01 09:00 local' }))).toThrow(
      /agent_run.started_at/,
    )
  })

  it('rejects a column that stores a number where text is required', () => {
    expect(() => fromToolInvocationRow(invocationRowWith({ tool_name: 42 as unknown as string }))).toThrow(
      /tool_invocation.tool_name/,
    )
  })
})
