/**
 * @file conversationBed
 * @description A deterministic conversation area for the application tests: the
 * memory repositories, a led clock and identifier source, an event collector,
 * and a scripted model that records the requests it received.
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
  const events: AgentEvent[] = []
  return {
    clock,
    ids,
    conversations,
    messages,
    messageContexts: new InMemoryMessageContextRepository(),
    attachments: new InMemoryAttachmentRepository(),
    jobPostings: new InMemoryJobPostingRepository(),
    runs,
    invocations: new InMemoryToolInvocationRepository(),
    fileStore: new InMemoryFileStore(),
    events,
    emit: (event) => {
      events.push(event)
    },
    model: new AggregateModelDouble(),
  }
}

