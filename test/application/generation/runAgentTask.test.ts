/**
 * @file runAgentTask
 * @description The loop's contract: a run row exists before the model is
 * called, a tool result reaches the next request, and a bad tool call is an
 * outcome the run survives rather than an error that ends it.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runAgentTask } from '../../../src/application/generation/RunAgentTask'
import type { AgentTools } from '../../../src/application/generation/RunAgentTask'
import type { ToolInvocationRecorder } from '../../../src/application/generation/ApproveToolInvocation'
import { buildToolRegistry } from '../../../src/application/generation/buildToolRegistry'
import type { ToolRegistryDeps } from '../../../src/application/generation/buildToolRegistry'
import type { JobPostingRepository } from '../../../src/application/generation/ParseJobPosting'
import { layout } from '../../../src/application/layout/layout'
import { FixtureTextMeasurer } from '../../../src/infrastructure/measurement/FixtureTextMeasurer'
import type { AgentRun } from '../../../src/domain/generation/AgentRun'
import type { ToolInvocation } from '../../../src/domain/generation/ToolInvocation'
import type { AgentRunRepository } from '../../../src/domain/generation/ports/AgentRunRepository'
import type { ChatRequest, ModelChunk, ModelProvider, ToolSchema } from '../../../src/domain/generation/ports/ModelProvider'
import type { RegisteredTool, ToolContext } from '../../../src/domain/generation/ports/ToolRegistry'
import type { JobPosting } from '../../../src/domain/generation/JobPosting'
import { addClaim, addVariant, createExperience } from '../../../src/domain/catalog/Experience'
import type { Experience } from '../../../src/domain/catalog/Experience'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { err, ok } from '../../../src/domain/shared/Result'
import type { Result } from '../../../src/domain/shared/Result'
import type { AgentRunId, JobPostingId, ToolInvocationId } from '../../../src/domain/shared/branded-id'
import {
  asClaimId,
  asExperienceId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import {
  InMemoryExperienceRepository,
  InMemoryProfileRepository,
} from '../../support/inMemoryCatalogRepositories'
import { InMemoryResumeRepository } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

class ScriptedModel implements ModelProvider {
  readonly id = 'scripted'
  readonly modelId = 'scripted-1'
  readonly requests: ChatRequest[] = []
  readonly offeredSchemas: (readonly ToolSchema[])[] = []
  #turn = 0

  constructor(
    private readonly turns: readonly (readonly ModelChunk[])[],
    private readonly beforeTurn: () => Promise<void> = async () => {},
  ) {}

  async *stream(request: ChatRequest, tools: readonly ToolSchema[]): AsyncIterable<ModelChunk> {
    // Copied, because the loop keeps appending to the array it handed over.
    this.requests.push({ ...request, messages: request.messages.map((entry) => ({ ...entry })) })
    this.offeredSchemas.push(tools)
    await this.beforeTurn()
    const chunks = this.turns[this.#turn]
    if (chunks === undefined) throw new Error('The scripted model has no further turns.')
    this.#turn += 1
    for (const chunk of chunks) yield chunk
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

  all(): readonly AgentRun[] {
    return [...this.rows.values()]
  }
}

class RecordedInvocations implements ToolInvocationRecorder {
  readonly rows = new Map<ToolInvocationId, ToolInvocation>()

  async record(invocation: ToolInvocation): Promise<void> {
    this.rows.set(invocation.id, invocation)
  }

  list(): readonly ToolInvocation[] {
    return [...this.rows.values()]
  }
}

class InMemoryJobPostings implements JobPostingRepository {
  private readonly rows = new Map<JobPostingId, JobPosting>()

  constructor(postings: readonly JobPosting[] = []) {
    for (const posting of postings) this.rows.set(posting.id, posting)
  }

  async findById(id: JobPostingId): Promise<JobPosting | null> {
    return this.rows.get(id) ?? null
  }

  async listAll(): Promise<readonly JobPosting[]> {
    return [...this.rows.values()]
  }

  async save(jobPosting: JobPosting): Promise<void> {
    this.rows.set(jobPosting.id, jobPosting)
  }
}

function sampleExperience(): Experience {
  const created = createExperience(
    { id: asExperienceId('exp-1'), kind: 'work', title: '后端工程师', organization: 'ACME' },
    NOW,
  )
  const withVariant = addVariant(
    created,
    {
      id: asVariantId('var-1'),
      label: '默认',
      content: '负责支付网关',
      emphasis: null,
      draftedByRunId: null,
      confirmedAt: NOW,
    },
    NOW,
  )
  return addClaim(
    withVariant,
    { id: asClaimId('clm-1'), kind: 'responsibility', statement: '负责支付网关', sourceField: null, status: 'confirmed' },
    NOW,
  )
}

interface Harness {
  readonly ctx: ToolContext
  readonly runs: InMemoryAgentRunRepository
  readonly invocations: RecordedInvocations
  readonly registryDeps: ToolRegistryDeps
}

function newHarness(): Harness {
  const clock = new FixedClock(NOW)
  const experiences = new InMemoryExperienceRepository()
  experiences.seed(sampleExperience())
  const profiles = InMemoryProfileRepository.seeded(NOW)
  const resumes = new InMemoryResumeRepository(() => clock.now())
  const runs = new InMemoryAgentRunRepository()
  const measurer = new FixtureTextMeasurer()
  return {
    ctx: {
      resumes,
      experiences,
      profiles,
      runs,
      clock,
      layout: (input) => layout({ ...input, measurer }),
    },
    runs,
    invocations: new RecordedInvocations(),
    registryDeps: {
      jobPostings: new InMemoryJobPostings(),
      ids: new SequentialIdGenerator(),
      resumeCreation: resumes,
      measurer,
    },
  }
}

function toolsFor(registryDeps: ToolRegistryDeps): (runId: AgentRunId) => AgentTools {
  return (runId) => buildToolRegistry(registryDeps, runId)
}

function toolCall(name: string, args: Readonly<Record<string, unknown>>): ModelChunk {
  return { type: 'toolCall', name, argsJson: JSON.stringify(args) }
}

describe('runAgentTask', () => {
  it('executes a tool and feeds its result back to the model', async () => {
    const harness = newHarness()
    const model = new ScriptedModel([
      [toolCall('searchExperiences', { keyword: '支付' })],
      [{ type: 'text', textDelta: '找到了。' }],
    ])

    const run = await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids },
      { prompt: '找一条支付相关经历', tools: toolsFor(harness.registryDeps) },
    )
    expect(run.errorText).toBeNull()
    expect(run.status).toBe('completed')
    const followUp = model.requests[1]
    expect(followUp?.messages.at(-1)?.text).toContain('Result of searchExperiences')
    const invocation = harness.invocations.list().at(0)
    expect(invocation?.toolName).toBe('searchExperiences')
    expect(invocation?.risk).toBe('read')
    expect(invocation?.approvalState).toBe('executed')
    expect(JSON.parse(invocation?.resultJson ?? '{}')).toMatchObject({ ok: true })
  })

  it('offers the registry schemas to the model on every turn', async () => {
    const harness = newHarness()
    const model = new ScriptedModel([[{ type: 'text', textDelta: '好的。' }]])

    await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids },
      { prompt: '你好', tools: toolsFor(harness.registryDeps) },
    )

    expect(model.offeredSchemas[0]?.map((schema) => schema.name)).toContain('proposeVariant')
  })

  it('records a malformed tool argument and keeps the run alive', async () => {
    const harness = newHarness()
    const model = new ScriptedModel([
      [toolCall('searchExperiences', { keyword: 42 })],
      [{ type: 'text', textDelta: '换个说法。' }],
    ])

    const run = await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids },
      { prompt: '找一条经历', tools: toolsFor(harness.registryDeps) },
    )

    expect(run.status).toBe('completed')
    const invocation = harness.invocations.list().at(0)
    expect(JSON.parse(invocation?.resultJson ?? '{}')).toMatchObject({ ok: false })
    expect(model.requests[1]?.messages.at(-1)?.text).toContain('Result of searchExperiences')
  })

  it('refuses an unregistered tool name without writing an invocation row', async () => {
    const harness = newHarness()
    const model = new ScriptedModel([
      [toolCall('deleteEverything', {})],
      [{ type: 'text', textDelta: '好。' }],
    ])

    const run = await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids },
      { prompt: '清空', tools: toolsFor(harness.registryDeps) },
    )

    expect(run.status).toBe('completed')
    expect(harness.invocations.list()).toHaveLength(0)
    expect(model.requests[1]?.messages.at(-1)?.text).toContain('No tool named')
  })

  it('creates the run before the first model call', async () => {
    const harness = newHarness()
    const model = new ScriptedModel([[{ type: 'text', textDelta: '好。' }]], async () => {
      const [open] = harness.runs.all()
      expect(open?.status).toBe('running')
      expect(open?.endedAt).toBeNull()
    })

    const run = await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids },
      { prompt: '你好', tools: toolsFor(harness.registryDeps) },
    )

    expect(run.status).toBe('completed')
    expect(harness.runs.all()).toHaveLength(1)
  })

  it('streams text deltas to the caller sink', async () => {
    const harness = newHarness()
    const model = new ScriptedModel([[{ type: 'text', textDelta: '第一段' }, { type: 'text', textDelta: '第二段' }]])
    const streamed: string[] = []

    await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids },
      { prompt: '你好', tools: toolsFor(harness.registryDeps), onTextDelta: (delta) => streamed.push(delta) },
    )

    expect(streamed).toEqual(['第一段', '第二段'])
  })

  it('ends as cancelled when the caller asks it to stop', async () => {
    const harness = newHarness()
    const model = new ScriptedModel([[toolCall('searchExperiences', { keyword: '支付' })]])

    const run = await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids },
      { prompt: '找一条经历', tools: toolsFor(harness.registryDeps), isCancelled: () => true },
    )

    expect(run.status).toBe('cancelled')
    expect(run.errorText).toBeNull()
    expect(harness.invocations.list()).toHaveLength(0)
  })

  it('fails the run with a diagnostic when the model call throws', async () => {
    const harness = newHarness()
    const model = new ScriptedModel([])

    const run = await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids },
      { prompt: '你好', tools: toolsFor(harness.registryDeps) },
    )

    expect(run.status).toBe('failed')
    expect(run.errorText).toContain('no further turns')
    expect(run.endedAt).not.toBeNull()
  })

  it('never assigns awaitingConfirmation, even for a destructive tool', async () => {
    const harness = newHarness()
    let executed = false
    const destructive = dangerousTool(() => {
      executed = true
      return 'gone'
    })
    const tools: (runId: AgentRunId) => AgentTools = () => ({
      registry: { list: () => [destructive], get: () => destructive },
      schemas: [],
    })
    const model = new ScriptedModel([[toolCall('deleteResume', { resumeId: 'resume-1' })]])

    const run = await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids },
      { prompt: '删掉它', tools },
    )

    expect(run.status).toBe('failed')
    expect(run.errorText).toContain('deleteResume')
    expect(run.errorText).not.toContain('awaitingConfirmation')
    expect(executed).toBe(false)
    expect(harness.invocations.list().at(0)?.approvalState).toBe('pending')
  })

  it('keeps a provider secret out of argsJson and resultJson', async () => {
    const harness = newHarness()
    const secret = 'sk-live-do-not-store'
    const echo = echoTool()
    const tools: (runId: AgentRunId) => AgentTools = () => ({
      registry: { list: () => [echo], get: () => echo },
      schemas: [],
    })
    const model = new ScriptedModel([[toolCall('echo', { text: secret })]])

    await runAgentTask(
      harness.ctx,
      {
        model,
        invocations: harness.invocations,
        ids: harness.registryDeps.ids,
        secrets: [secret],
      },
      { prompt: '复述', tools },
    )

    const invocation = harness.invocations.list().at(0)
    expect(invocation?.argsJson).not.toContain(secret)
    expect(invocation?.resultJson).not.toContain(secret)
    expect(invocation?.argsJson).toContain('[redacted]')
  })

  it('keeps a secret out of an argument the model spelled with JSON escapes', async () => {
    const harness = newHarness()
    const secret = 'sk-live-do-not-store'
    const echo = echoTool()
    const tools: (runId: AgentRunId) => AgentTools = () => ({
      registry: { list: () => [echo], get: () => echo },
      schemas: [],
    })
    // The credential is intact once the row is parsed, and absent from its text.
    const escaped = String.raw`sk-live-do-not-store`
    const model = new ScriptedModel([
      [{ type: 'toolCall', name: 'echo', argsJson: `{"text":"${escaped}"}` }],
      [{ type: 'text', textDelta: 'done' }],
    ])

    await runAgentTask(
      harness.ctx,
      { model, invocations: harness.invocations, ids: harness.registryDeps.ids, secrets: [secret] },
      { prompt: '复述', tools },
    )

    const invocation = harness.invocations.list().at(0)
    expect(invocation?.argsJson).not.toContain(secret)
    expect(invocation?.argsJson).toContain('[redacted]')
  })
})

function dangerousTool(onExecute: () => string): RegisteredTool<{ resumeId: string }, string> {
  return {
    name: 'deleteResume',
    description: '删除简历',
    risk: 'destructive',
    parse: (raw: unknown): Result<{ resumeId: string }> => {
      const parsed = z.object({ resumeId: z.string().min(1) }).safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async () => onExecute(),
  }
}

function echoTool(): RegisteredTool<{ text: string }, { echo: string }> {
  return {
    name: 'echo',
    description: '复述一段文本',
    risk: 'read',
    parse: (raw: unknown): Result<{ text: string }> => {
      const parsed = z.object({ text: z.string().min(1) }).safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (input) => ({ echo: input.text }),
  }
}
