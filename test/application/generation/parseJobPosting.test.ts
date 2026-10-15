/**
 * @file ParseJobPosting
 * @description The one use case that calls a model on its own. Its output is
 * stored, so the two things worth testing are that a fitting answer is kept
 * with its provenance and that an invented requirement is not.
 */

import { describe, expect, it } from 'vitest'
import { parseJobPosting } from '../../../src/application/generation/ParseJobPosting'
import type { JobPostingRepository } from '../../../src/application/generation/ParseJobPosting'
import type { AgentRun } from '../../../src/domain/generation/AgentRun'
import type { ModelChunk, ModelProvider } from '../../../src/domain/generation/ports/ModelProvider'
import type { AgentRunRepository } from '../../../src/domain/generation/ports/AgentRunRepository'
import type { JobPosting } from '../../../src/domain/generation/JobPosting'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import type { AgentRunId, JobPostingId } from '../../../src/domain/shared/branded-id'
import { asJobPostingId } from '../../../src/domain/shared/branded-id'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const RAW_TEXT = '负责支付网关的演进，要求熟悉 Java 与 PostgreSQL。'

const POSTING: JobPosting = {
  id: asJobPostingId('posting-1'),
  rawText: RAW_TEXT,
  source: '招聘网站',
  parsed: null,
  parsedByRunId: null,
  parsedAt: null,
  createdAt: NOW,
}

/** Yields the scripted reply as text deltas, the way an adapter would. */
class ScriptedModel implements ModelProvider {
  readonly id = 'scripted'
  readonly modelId = 'scripted-1'

  constructor(private readonly reply: string | Error) {}

  async *stream(): AsyncIterable<ModelChunk> {
    if (this.reply instanceof Error) throw this.reply
    for (const fragment of this.reply.match(/.{1,12}/gs) ?? []) {
      yield { type: 'text', textDelta: fragment }
    }
  }
}

class InMemoryJobPostings implements JobPostingRepository {
  constructor(private row: JobPosting) {}

  async findById(id: JobPostingId): Promise<JobPosting | null> {
    return id === this.row.id ? this.row : null
  }

  async listAll(): Promise<readonly JobPosting[]> {
    return [this.row]
  }

  async save(jobPosting: JobPosting): Promise<void> {
    this.row = jobPosting
  }

  current(): JobPosting {
    return this.row
  }
}

class InMemoryAgentRunRepository implements AgentRunRepository {
  readonly rows = new Map<AgentRunId, AgentRun>()

  async create(run: AgentRun): Promise<void> {
    this.rows.set(run.id, run)
  }

  async save(run: AgentRun): Promise<void> {
    this.rows.set(run.id, run)
  }

  async findById(id: AgentRunId): Promise<AgentRun | null> {
    return this.rows.get(id) ?? null
  }
}

function deps(model: ModelProvider) {
  const clock = new FixedClock(NOW)
  const runs = new InMemoryAgentRunRepository()
  const jobPostings = new InMemoryJobPostings(POSTING)
  return {
    deps: { model, jobPostings, runs, clock, ids: new SequentialIdGenerator('run') },
    jobPostings,
    runs,
  }
}

describe('parseJobPosting', () => {
  it('stores a fitting answer with the run that produced it', async () => {
    const reply = JSON.stringify({
      title: '后端工程师',
      company: 'ACME',
      responsibilities: ['负责支付网关的演进'],
      requirements: ['要求熟悉 Java 与 PostgreSQL'],
      keywords: ['支付', 'Java'],
    })
    const harness = deps(new ScriptedModel('```json\n' + reply + '\n```'))

    const result = await parseJobPosting(harness.deps, { jobPostingId: POSTING.id })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.jobPosting.parsed?.title).toBe('后端工程师')
    expect(result.value.jobPosting.parsedByRunId).toBe(result.value.run.id)
    expect(result.value.jobPosting.parsedAt).not.toBeNull()
    expect(result.value.run.status).toBe('completed')
    expect(harness.runs.rows.size).toBe(1)
  })

  it('refuses a requirement the description does not contain', async () => {
    const reply = JSON.stringify({
      title: '后端工程师',
      company: null,
      responsibilities: ['负责支付网关的演进'],
      requirements: ['要求八年以上的分布式系统经验'],
      keywords: ['支付'],
    })
    const harness = deps(new ScriptedModel(reply))

    const result = await parseJobPosting(harness.deps, { jobPostingId: POSTING.id })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('outputRejected')
    expect(harness.jobPostings.current().parsed).toBeNull()
    const [run] = harness.runs.rows.values()
    expect(run?.status).toBe('failed')
    expect(run?.errorText).toContain('八年以上的分布式系统经验')
  })

  it('refuses output that does not fit the parsed posting shape', async () => {
    const harness = deps(new ScriptedModel(JSON.stringify({ title: 42 })))

    const result = await parseJobPosting(harness.deps, { jobPostingId: POSTING.id })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('outputRejected')
  })

  it('refuses a reply with no JSON object', async () => {
    const harness = deps(new ScriptedModel('抱歉，我无法解析这个岗位描述。'))

    const result = await parseJobPosting(harness.deps, { jobPostingId: POSTING.id })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('outputRejected')
  })

  it('records a failed run when the model call throws', async () => {
    const harness = deps(new ScriptedModel(new Error('HTTP 500')))

    const result = await parseJobPosting(harness.deps, { jobPostingId: POSTING.id })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('modelFailed')
    const [run] = harness.runs.rows.values()
    expect(run?.status).toBe('failed')
    expect(run?.errorText).toContain('HTTP 500')
  })

  it('reports a posting that does not exist without starting a run', async () => {
    const harness = deps(new ScriptedModel('{}'))

    const result = await parseJobPosting(harness.deps, { jobPostingId: asJobPostingId('nope') })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('unknownPosting')
    expect(harness.runs.rows.size).toBe(0)
  })
})
