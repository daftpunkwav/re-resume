/**
 * @file conversationBed
 * @description A deterministic conversation area for the application tests: the
 * memory repositories, a led clock and identifier source, an event collector, a
 * scripted model that records the requests it received, and the tool pack built
 * over the same memory library and resume store.
 */

import { AggregateModelDouble } from './modelDouble'
import type { AgentEvent } from '../../src/domain/generation/AgentEvent'
import type { ConversationRepository } from '../../src/domain/conversation/ports/ConversationRepository'
import type { MessageContextRepository } from '../../src/domain/conversation/ports/MessageContextRepository'
import type { MessageRepository } from '../../src/domain/conversation/ports/MessageRepository'
import type { AttachmentRepository } from '../../src/domain/conversation/ports/AttachmentRepository'
import type { JobPostingRepository } from '../../src/domain/generation/ports/JobPostingRepository'
import type { AgentRunRepository } from '../../src/domain/generation/ports/AgentRunRepository'
import type { ToolInvocationRepository } from '../../src/domain/generation/ports/ToolInvocationRepository'
import type { FileStore } from '../../src/domain/conversation/ports/FileStore'
import type { ToolRegistry } from '../../src/domain/generation/ports/ToolRegistry'
import type { ChangeLogRepository } from '../../src/domain/changes/ports/ChangeLogRepository'
import type { CustomModuleRepository } from '../../src/domain/info/ports/CustomModuleRepository'
import type { InfoEntryRepository } from '../../src/domain/info/ports/InfoEntryRepository'
import type { ResumeRepository } from '../../src/domain/resume/ports/ResumeRepository'
import type { TextMeasurer } from '../../src/domain/resume/ports/TextMeasurer'
import { InMemoryFileStore } from '../../src/infrastructure/preview/InMemoryFileStore'
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
import { ResumeEntryReferences } from '../../src/infrastructure/persistence/resume/ResumeEntryReferences'
import { FixtureTextMeasurer } from '../../src/infrastructure/measurement/FixtureTextMeasurer'
import { buildToolRegistry } from '../../src/application/generation/buildToolRegistry'
import type { ToolPackDeps } from '../../src/application/generation/tools/deps'
import { FixedClock, SequentialIdGenerator } from './fakeEnvironment'

export interface ConversationBed {
  readonly clock: FixedClock
  readonly ids: SequentialIdGenerator
  readonly conversations: ConversationRepository
  readonly messages: MessageRepository
  readonly messageContexts: MessageContextRepository
  readonly attachments: AttachmentRepository
  readonly jobPostings: JobPostingRepository
  readonly runs: AgentRunRepository
  readonly invocations: ToolInvocationRepository
  readonly fileStore: FileStore
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly changes: ChangeLogRepository
  readonly resumes: ResumeRepository
  readonly measurer: TextMeasurer
  readonly toolDeps: ToolPackDeps
  readonly registry: ToolRegistry
  readonly events: AgentEvent[]
  readonly emit: (event: AgentEvent) => void
  readonly model: AggregateModelDouble
}

export function createConversationBed(): ConversationBed {
  const clock = new FixedClock()
  const ids = new SequentialIdGenerator('id')
  const conversations = new InMemoryConversationRepository()
  const runs = new InMemoryAgentRunRepository()
  const messages = new InMemoryMessageRepository({ messages: [], runs: runs.rows })
  const attachments = new InMemoryAttachmentRepository()
  const jobPostings = new InMemoryJobPostingRepository()
  const invocations = new InMemoryToolInvocationRepository()
  const fileStore = new InMemoryFileStore()
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  const resumes = new InMemoryResumeRepository(clock)
  const measurer = new FixtureTextMeasurer()
  const events: AgentEvent[] = []
  const model = new AggregateModelDouble()
  const toolDeps: ToolPackDeps = {
    model,
    entries,
    customModules,
    references: new ResumeEntryReferences(resumes),
    resumes,
    changes,
    jobPostings,
    runs,
    attachments,
    fileStore,
    measurer,
    clock,
    ids,
  }
  return {
    clock,
    ids,
    conversations,
    messages,
    messageContexts: new InMemoryMessageContextRepository(),
    attachments,
    jobPostings,
    runs,
    invocations,
    fileStore,
    entries,
    customModules,
    changes,
    resumes,
    measurer,
    toolDeps,
    registry: buildToolRegistry(toolDeps),
    events,
    emit: (event) => {
      events.push(event)
    },
    model,
  }
}
