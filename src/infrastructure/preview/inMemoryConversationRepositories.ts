/**
 * @file inMemoryConversationRepositories
 * @description Memory-backed conversation ports for the browser preview. The
 * preview window runs the same use cases as the application, against
 * repositories that never touch the disk or the network.
 *
 * Constraints:
 * - Preview assembly only.
 * - Each repository keeps values by reference, exactly as a row keeps columns:
 *   callers treat what they read as immutable.
 * - The run gate mirrors the database: `createRun` returns the run already
 *   running for the conversation instead of inserting a second one.
 */

import type { AgentRun } from '../../domain/generation/AgentRun'
import type { AgentRunRepository } from '../../domain/generation/ports/AgentRunRepository'
import type { Attachment } from '../../domain/conversation/Attachment'
import type { AttachmentRepository } from '../../domain/conversation/ports/AttachmentRepository'
import type { Conversation } from '../../domain/conversation/Conversation'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { JobPosting } from '../../domain/generation/JobPosting'
import type { JobPostingRepository } from '../../domain/generation/ports/JobPostingRepository'
import type { Message } from '../../domain/conversation/Message'
import type { MessageContext } from '../../domain/conversation/MessageContext'
import type { MessageContextRepository } from '../../domain/conversation/ports/MessageContextRepository'
import type { MessageRepository } from '../../domain/conversation/ports/MessageRepository'
import type { ToolInvocation } from '../../domain/generation/ToolInvocation'
import type { ToolInvocationRepository } from '../../domain/generation/ports/ToolInvocationRepository'
import type {
  AgentRunId,
  AttachmentId,
  ConversationId,
  JobPostingId,
  MessageId,
  ToolInvocationId,
} from '../../domain/shared/branded-id'

export class InMemoryConversationRepository implements ConversationRepository {
  readonly rows: Map<ConversationId, Conversation>

  constructor(initial: readonly Conversation[] = []) {
    this.rows = new Map(initial.map((conversation) => [conversation.id, conversation]))
  }

  async findById(id: ConversationId): Promise<Conversation | null> {
    return this.rows.get(id) ?? null
  }

  async listAll(): Promise<readonly Conversation[]> {
    return [...this.rows.values()]
  }

  async insert(conversation: Conversation): Promise<void> {
    if (this.rows.has(conversation.id)) {
      throw new Error(`Conversation ${conversation.id} already exists.`)
    }
    this.rows.set(conversation.id, conversation)
  }

  async update(conversation: Conversation): Promise<void> {
    if (!this.rows.has(conversation.id)) {
      throw new Error(`Conversation ${conversation.id} does not exist.`)
    }
    this.rows.set(conversation.id, conversation)
  }

  async delete(id: ConversationId): Promise<void> {
    this.rows.delete(id)
  }
}

export class InMemoryAgentRunRepository implements AgentRunRepository {
  readonly rows: Map<AgentRunId, AgentRun>

  constructor(initial: readonly AgentRun[] = []) {
    this.rows = new Map(initial.map((run) => [run.id, run]))
  }

  async create(run: AgentRun): Promise<void> {
    if (this.rows.has(run.id)) throw new Error(`Agent run ${run.id} already exists.`)
    this.rows.set(run.id, run)
  }

  async save(run: AgentRun): Promise<void> {
    if (!this.rows.has(run.id)) throw new Error(`Agent run ${run.id} does not exist.`)
    this.rows.set(run.id, run)
  }

  async findById(id: AgentRunId): Promise<AgentRun | null> {
    return this.rows.get(id) ?? null
  }

  async findRunningByConversation(id: ConversationId): Promise<AgentRun | null> {
    return (
      [...this.rows.values()].find(
        (run) => run.conversationId === id && run.status === 'running',
      ) ?? null
    )
  }

  async listRunning(): Promise<readonly AgentRun[]> {
    return [...this.rows.values()].filter((run) => run.status === 'running')
  }
}

export class InMemoryMessageRepository implements MessageRepository {
  readonly messages: Map<MessageId, Message>
  readonly runs: Map<AgentRunId, AgentRun>

  constructor(options: {
    readonly messages?: readonly Message[]
    readonly runs?: Map<AgentRunId, AgentRun>
  } = {}) {
    this.messages = new Map((options.messages ?? []).map((message) => [message.id, message]))
    this.runs = options.runs ?? new Map()
  }

  async listByConversation(id: ConversationId, limit: number): Promise<readonly Message[]> {
    if (limit <= 0) return []
    const messages = [...this.messages.values()]
      .filter((message) => message.conversationId === id)
      .sort((left, right) => left.seq - right.seq)
    return messages.slice(-limit)
  }

  async findBySeq(id: ConversationId, seq: number): Promise<Message | null> {
    return (
      [...this.messages.values()].find(
        (message) => message.conversationId === id && message.seq === seq,
      ) ?? null
    )
  }

  async findById(id: MessageId): Promise<Message | null> {
    return this.messages.get(id) ?? null
  }

  async nextSeq(id: ConversationId): Promise<number> {
    const sequences = [...this.messages.values()]
      .filter((message) => message.conversationId === id)
      .map((message) => message.seq)
    return sequences.length === 0 ? 1 : Math.max(...sequences) + 1
  }

  async insert(message: Message): Promise<void> {
    for (const existing of this.messages.values()) {
      if (
        existing.conversationId === message.conversationId &&
        existing.seq === message.seq
      ) {
        throw new Error(`A message with sequence ${message.seq} already exists in this conversation.`)
      }
    }
    if (this.messages.has(message.id)) throw new Error(`Message ${message.id} already exists.`)
    this.messages.set(message.id, message)
  }

  async update(message: Message): Promise<void> {
    if (!this.messages.has(message.id)) throw new Error(`Message ${message.id} does not exist.`)
    this.messages.set(message.id, message)
  }

  async deleteAfter(id: ConversationId, seq: number): Promise<void> {
    for (const [messageId, message] of this.messages) {
      if (message.conversationId === id && message.seq > seq) this.messages.delete(messageId)
    }
  }

  async createRun(run: AgentRun): Promise<AgentRun> {
    if (run.conversationId !== null) {
      const running = await this.findRunningByConversation(run.conversationId)
      if (running !== null) return running
    }
    this.runs.set(run.id, run)
    return run
  }

  async findRunningByConversation(id: ConversationId): Promise<AgentRun | null> {
    return (
      [...this.runs.values()].find(
        (run) => run.conversationId === id && run.status === 'running',
      ) ?? null
    )
  }
}

export class InMemoryMessageContextRepository implements MessageContextRepository {
  readonly rows: Map<MessageId, MessageContext[]>

  constructor(initial: readonly { readonly messageId: MessageId; readonly context: MessageContext }[] = []) {
    this.rows = new Map()
    for (const entry of initial) {
      const contexts = this.rows.get(entry.messageId) ?? []
      contexts.push(entry.context)
      this.rows.set(entry.messageId, contexts)
    }
  }

  async listByMessage(id: MessageId): Promise<readonly MessageContext[]> {
    return this.rows.get(id) ?? []
  }

  async insertAll(
    contexts: readonly { readonly messageId: MessageId; readonly context: MessageContext }[],
  ): Promise<void> {
    for (const entry of contexts) {
      const existing = this.rows.get(entry.messageId) ?? []
      const duplicate = existing.some(
        (context) => context.kind === entry.context.kind && context.refId === entry.context.refId,
      )
      if (!duplicate) existing.push(entry.context)
      this.rows.set(entry.messageId, existing)
    }
  }
}

export class InMemoryAttachmentRepository implements AttachmentRepository {
  readonly rows: Map<AttachmentId, Attachment>

  constructor(initial: readonly Attachment[] = []) {
    this.rows = new Map(initial.map((attachment) => [attachment.id, attachment]))
  }

  async findById(id: AttachmentId): Promise<Attachment | null> {
    return this.rows.get(id) ?? null
  }

  async findBySha256(sha256: string): Promise<Attachment | null> {
    return [...this.rows.values()].find((attachment) => attachment.sha256 === sha256) ?? null
  }

  async listByIds(ids: readonly AttachmentId[]): Promise<readonly Attachment[]> {
    return ids
      .map((id) => this.rows.get(id))
      .filter((attachment): attachment is Attachment => attachment !== undefined)
  }

  async insert(attachment: Attachment): Promise<void> {
    this.rows.set(attachment.id, attachment)
  }
}

export class InMemoryJobPostingRepository implements JobPostingRepository {
  readonly rows: Map<JobPostingId, JobPosting>

  constructor(initial: readonly JobPosting[] = []) {
    this.rows = new Map(initial.map((posting) => [posting.id, posting]))
  }

  async findById(id: JobPostingId): Promise<JobPosting | null> {
    return this.rows.get(id) ?? null
  }

  async listRecent(limit: number): Promise<readonly JobPosting[]> {
    return [...this.rows.values()]
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
      .slice(0, limit)
  }

  async insert(posting: JobPosting): Promise<void> {
    if (this.rows.has(posting.id)) throw new Error(`Job posting ${posting.id} already exists.`)
    this.rows.set(posting.id, posting)
  }

  async save(posting: JobPosting): Promise<void> {
    if (!this.rows.has(posting.id)) throw new Error(`Job posting ${posting.id} does not exist.`)
    this.rows.set(posting.id, posting)
  }
}

export class InMemoryToolInvocationRepository implements ToolInvocationRepository {
  readonly rows: Map<ToolInvocationId, ToolInvocation>

  constructor(initial: readonly ToolInvocation[] = []) {
    this.rows = new Map(initial.map((invocation) => [invocation.id, invocation]))
  }

  async record(invocation: ToolInvocation): Promise<void> {
    this.rows.set(invocation.id, invocation)
  }

  async listByRun(runId: AgentRunId): Promise<readonly ToolInvocation[]> {
    return [...this.rows.values()]
      .filter((invocation) => invocation.runId === runId)
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt),
      )
  }
}
