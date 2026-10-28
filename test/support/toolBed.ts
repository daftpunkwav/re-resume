/**
 * @file toolBed
 * @description A ready tool pack for application tests: the memory library, the
 * memory resume store, the conversation ports a ToolContext needs, the production
 * registry built over them and a scripted model. One call returns an independent
 * pack, so a test never shares state with the next one.
 */

import { createConversation } from '../../src/application/conversation/createConversation'
import { buildToolRegistry } from '../../src/application/generation/buildToolRegistry'
import type { ToolPackDeps } from '../../src/application/generation/tools/deps'
import type { AgentEvent } from '../../src/domain/generation/AgentEvent'
import type { Conversation } from '../../src/domain/conversation/Conversation'
import type { RegisteredTool, ToolContext, ToolRegistry } from '../../src/domain/generation/ports/ToolRegistry'
import type { Result } from '../../src/domain/shared/Result'
import { asAgentRunId } from '../../src/domain/shared/branded-id'
import type { AgentRunId } from '../../src/domain/shared/branded-id'
import {
  InMemoryAgentRunRepository,
  InMemoryAttachmentRepository,
  InMemoryConversationRepository,
  InMemoryJobPostingRepository,
  InMemoryMessageContextRepository,
  InMemoryMessageRepository,
  InMemoryToolInvocationRepository,
} from '../../src/infrastructure/preview/inMemoryConversationRepositories'
import {
  InMemoryChangeLogRepository,
  InMemoryCustomModuleRepository,
  InMemoryInfoEntryRepository,
} from '../../src/infrastructure/preview/inMemoryInfoRepositories'
import { InMemoryResumeRepository } from '../../src/infrastructure/preview/inMemoryResumeRepository'
import { InMemoryFileStore } from '../../src/infrastructure/preview/InMemoryFileStore'
import { ResumeEntryReferences } from '../../src/infrastructure/persistence/resume/ResumeEntryReferences'
import { FixtureTextMeasurer } from '../../src/infrastructure/measurement/FixtureTextMeasurer'
import {
  PREVIEW_INFO_CUSTOM_MODULES,
  PREVIEW_INFO_ENTRIES,
} from '../../src/infrastructure/preview/fixtures.info'
import { PREVIEW_RESUMES } from '../../src/infrastructure/preview/fixtures.resume'
import { AggregateModelDouble } from './modelDouble'
import { FixedClock, SequentialIdGenerator } from './fakeEnvironment'

export interface ToolBed {
  readonly clock: FixedClock
  readonly ids: SequentialIdGenerator
  readonly entries: InMemoryInfoEntryRepository
  readonly customModules: InMemoryCustomModuleRepository
  readonly changes: InMemoryChangeLogRepository
  readonly resumes: InMemoryResumeRepository
  readonly jobPostings: InMemoryJobPostingRepository
  readonly runs: InMemoryAgentRunRepository
  readonly attachments: InMemoryAttachmentRepository
  readonly invocations: InMemoryToolInvocationRepository
  readonly fileStore: InMemoryFileStore
  readonly conversations: InMemoryConversationRepository
  readonly messages: InMemoryMessageRepository
  readonly messageContexts: InMemoryMessageContextRepository
  readonly model: AggregateModelDouble
  readonly measurer: FixtureTextMeasurer
  readonly deps: ToolPackDeps
  readonly registry: ToolRegistry
  readonly events: AgentEvent[]
}

export interface ToolBedOptions {
  /** Seed the preview library and its resumes; true by default. */
  readonly seedData?: boolean
}

export function createToolBed(options: ToolBedOptions = {}): ToolBed {
  const clock = new FixedClock()
  const ids = new SequentialIdGenerator('tool')
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  const resumes = new InMemoryResumeRepository(clock)
  const conversations = new InMemoryConversationRepository()
  const runs = new InMemoryAgentRunRepository()
  const messages = new InMemoryMessageRepository({ messages: [], runs: runs.rows })
  if (options.seedData !== false) {
    entries.seed(PREVIEW_INFO_ENTRIES)
    customModules.seed(PREVIEW_INFO_CUSTOM_MODULES)
    resumes.seed(PREVIEW_RESUMES)
  }
  const deps: ToolPackDeps = {
    model: new AggregateModelDouble(),
    entries,
    customModules,
    references: new ResumeEntryReferences(resumes),
    resumes,
    changes,
    jobPostings: new InMemoryJobPostingRepository(),
    runs,
    attachments: new InMemoryAttachmentRepository(),
    fileStore: new InMemoryFileStore(),
    measurer: new FixtureTextMeasurer(),
    clock,
    ids,
  }
  return {
    clock,
    ids,
    entries,
    customModules,
    changes,
    resumes,
    jobPostings: deps.jobPostings as InMemoryJobPostingRepository,
    runs,
    attachments: deps.attachments as InMemoryAttachmentRepository,
    invocations: new InMemoryToolInvocationRepository(),
    fileStore: deps.fileStore as InMemoryFileStore,
    conversations,
    messages,
    messageContexts: new InMemoryMessageContextRepository(),
    model: deps.model as AggregateModelDouble,
    measurer: deps.measurer as FixtureTextMeasurer,
    deps,
    registry: buildToolRegistry(deps),
    events: [],
  }
}

/** Creates a conversation and returns it, so a ToolContext has an identity. */
export async function createToolConversation(bed: ToolBed): Promise<Conversation> {
  return createConversation(
    { conversations: bed.conversations, clock: bed.clock, ids: bed.ids },
    {},
  )
}

/** The ToolContext a direct tool invocation receives. */
export function toolContextOf(
  bed: ToolBed,
  conversation: Conversation,
  runId: AgentRunId = asAgentRunId('run-tool-test'),
): ToolContext {
  return {
    conversations: bed.conversations,
    messages: bed.messages,
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
    runId,
    conversationId: conversation.id,
    emit: (event) => {
      bed.events.push(event)
    },
  }
}

export interface ToolCallResult {
  readonly ok: boolean
  readonly value?: unknown
  readonly parseError?: string
}

/**
 * Parses and executes one tool through its registered entry point, exactly the
 * way the run loop does. A parse refusal is reported separately from a value.
 */
export async function invokeTool(
  bed: ToolBed,
  name: string,
  args: unknown,
  context: ToolContext,
): Promise<ToolCallResult> {
  const tool = bed.registry.get(name) as RegisteredTool<unknown, unknown> | undefined
  if (tool === undefined) throw new Error(`Tool "${name}" is not registered.`)
  const parsed: Result<unknown> = tool.parse(args)
  if (!parsed.ok) return { ok: false, parseError: parsed.error.message }
  const value = await tool.execute(parsed.value, context)
  return { ok: true, value }
}
