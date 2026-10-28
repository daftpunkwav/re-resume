/**
 * @file conversation wiring
 * @description Assembles the conversation area: the repositories it reads and
 * writes, the provider it streams through, the run loop, and the service
 * surface the interface calls.
 *
 * Responsibilities:
 * - Construct every use case of the conversation, generation and job areas with
 *   the ports they declare
 * - Build the provider adapter from the active provider row and its credential
 * - Hold the per-root active-run registry, so one conversation streams once
 *
 * Constraints:
 * - This module only assembles: no business rule lives here. A rule stated in a
 *   use case stays in the use case.
 * - The credential is passed to the adapter and to the redactor, never to a
 *   repository; a database row only names the secret reference.
 */

import type { AgentEvent } from '../../domain/generation/AgentEvent'
import type { AgentRun } from '../../domain/generation/AgentRun'
import type { Attachment } from '../../domain/conversation/Attachment'
import type { Conversation } from '../../domain/conversation/Conversation'
import type { Message } from '../../domain/conversation/Message'
import type { MessageContext } from '../../domain/conversation/MessageContext'
import type { ConversationRepository } from '../../domain/conversation/ports/ConversationRepository'
import type { MessageContextRepository } from '../../domain/conversation/ports/MessageContextRepository'
import type { MessageRepository } from '../../domain/conversation/ports/MessageRepository'
import type { AttachmentRepository } from '../../domain/conversation/ports/AttachmentRepository'
import type { FileStore } from '../../domain/conversation/ports/FileStore'
import type { AgentRunRepository } from '../../domain/generation/ports/AgentRunRepository'
import type { JobPostingRepository } from '../../domain/generation/ports/JobPostingRepository'
import type { ToolInvocationRepository } from '../../domain/generation/ports/ToolInvocationRepository'
import type { ChangeLogRepository } from '../../domain/changes/ports/ChangeLogRepository'
import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntryReferenceQuery } from '../../domain/info/ports/InfoEntryReferenceQuery'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { TextMeasurer } from '../../domain/resume/ports/TextMeasurer'
import type { ModelProvider } from '../../domain/generation/ports/ModelProvider'
import type { ProviderConfig } from '../../domain/settings/ProviderConfig'
import type { ProviderConfigRepository } from '../../domain/settings/ports/ProviderConfigRepository'
import type { SecretStore } from '../../domain/generation/ports/SecretStore'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { AttachmentId, ConversationId, MessageId } from '../../domain/shared/branded-id'
import type { Result } from '../../domain/shared/Result'
import { DomainError } from '../../domain/shared/DomainError'
import { appendMessage } from '../../application/conversation/appendMessage'
import type { AppendMessageInput } from '../../application/conversation/appendMessage'
import { autoTitleConversation } from '../../application/conversation/autoTitle'
import { createConversation } from '../../application/conversation/createConversation'
import type { CreateConversationInput } from '../../application/conversation/createConversation'
import { deleteConversation } from '../../application/conversation/deleteConversation'
import { ingestAttachment } from '../../application/conversation/ingestAttachment'
import type { IngestAttachmentInput } from '../../application/conversation/ingestAttachment'
import { listConversations } from '../../application/conversation/listConversations'
import type { ListConversationsOutput } from '../../application/conversation/listConversations'
import { renameConversation } from '../../application/conversation/renameConversation'
import { togglePinned } from '../../application/conversation/togglePinned'
import { parseJobPosting } from '../../application/job/parseJobPosting'
import type {
  JobPostingParseFailure,
  ParsedJobPostingOutcome,
  ParseJobPostingInput,
} from '../../application/job/parseJobPosting'
import { cancelRun } from '../../application/generation/cancelRun'
import { recoverInterruptedRuns } from '../../application/generation/recoverInterruptedRuns'
import type { RecoverySummary } from '../../application/generation/recoverInterruptedRuns'
import { retryRun } from '../../application/generation/retryRun'
import { runAgentTurn } from '../../application/generation/runAgentTurn'
import { buildToolRegistry } from '../../application/generation/buildToolRegistry'
import type { RunAgentTurnInput } from '../../application/generation/runAgentTurn'
import type { ActiveRunRegistry } from '../../application/generation/activeRunRegistry'
import { UnconfiguredModelProvider } from '../../infrastructure/http/ProviderAdapters/UnconfiguredModelProvider'
import { OpenAiCompatibleProvider } from '../../infrastructure/http/ProviderAdapters/OpenAiCompatibleProvider'
import { AnthropicProvider } from '../../infrastructure/http/ProviderAdapters/AnthropicProvider'
import { resolveImageSupport } from '../../domain/settings/ProviderConfig'
import type { HttpClient } from '../../infrastructure/http/TauriHttpClient'

/** The repositories the conversation area owns. */
export interface ConversationRepositories {
  readonly conversations: ConversationRepository
  readonly messages: MessageRepository
  readonly messageContexts: MessageContextRepository
  readonly attachments: AttachmentRepository
  readonly jobPostings: JobPostingRepository
  readonly runs: AgentRunRepository
  readonly invocations: ToolInvocationRepository
  readonly fileStore: FileStore
}

/** The library and resume ports the tool pack writes through. */
export interface ConversationLibrary {
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly references: InfoEntryReferenceQuery
  readonly resumes: ResumeRepository
  readonly changes: ChangeLogRepository
  readonly measurer: TextMeasurer
}

export interface ConversationWiringOptions {
  readonly repositories: ConversationRepositories
  readonly library: ConversationLibrary
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly model: ModelProvider
  /** null disables model-generated titles. */
  readonly titleModel: ModelProvider | null
  readonly activeRuns: ActiveRunRegistry
  /** Credential values currently loaded; every persisted string is scrubbed. */
  readonly secrets: readonly string[]
  readonly maxOutputTokens?: number
  readonly onWarning?: (message: string, error: unknown) => void
}

/** The surface the interface calls; every method is one use case. */
export interface ConversationService {
  createConversation(input?: CreateConversationInput): Promise<Conversation>
  renameConversation(input: { readonly conversationId: ConversationId; readonly title: string }): Promise<Conversation>
  togglePinned(input: { readonly conversationId: ConversationId; readonly pinned: boolean }): Promise<Conversation>
  deleteConversation(input: { readonly conversationId: ConversationId }): Promise<void>
  listConversations(): Promise<ListConversationsOutput>
  listMessages(conversationId: ConversationId, limit: number): Promise<readonly Message[]>
  /**
   * The context chips of the user turns in the same window the transcript was
   * read with, keyed by message. A message without chips is absent from the map.
   */
  listMessageContexts(
    conversationId: ConversationId,
    limit: number,
  ): Promise<ReadonlyMap<MessageId, readonly MessageContext[]>>
  appendMessage(input: AppendMessageInput): Promise<Message>
  autoTitle(input: {
    readonly conversationId: ConversationId
    readonly firstUserMessage: string
  }): Promise<Conversation>
  ingestAttachment(input: IngestAttachmentInput): Promise<Attachment>
  /**
   * The attachment rows of one message's ids, in the message's order. A row
   * that no longer exists is skipped rather than failing the transcript: a
   * message can outlive a file whose row an older sweep removed.
   */
  listAttachments(attachmentIds: readonly AttachmentId[]): Promise<readonly Attachment[]>
  /** The stored bytes of one attachment; the transcript renders the thumbnail. */
  readAttachmentBytes(attachmentId: AttachmentId): Promise<Uint8Array>
  runTurn(input: RunAgentTurnInput, emit: (event: AgentEvent) => void): Promise<AgentRun>
  retryRun(
    input: { readonly conversationId: ConversationId; readonly messageId: MessageId },
    emit: (event: AgentEvent) => void,
  ): Promise<AgentRun>
  cancelRun(input: { readonly conversationId: ConversationId }): Promise<boolean>
  parseJobPosting(
    input: ParseJobPostingInput,
  ): Promise<Result<ParsedJobPostingOutcome, JobPostingParseFailure>>
  recoverInterruptedRuns(): Promise<RecoverySummary>
}

export type ConversationServiceInput = ConversationWiringOptions

export function createConversationService(input: ConversationServiceInput): ConversationService {
  const {
    repositories,
    library,
    clock,
    ids,
    model,
    titleModel,
    activeRuns,
    secrets,
    maxOutputTokens,
    onWarning,
  } = input
  const registry = buildToolRegistry({
    model,
    entries: library.entries,
    customModules: library.customModules,
    references: library.references,
    resumes: library.resumes,
    changes: library.changes,
    jobPostings: repositories.jobPostings,
    runs: repositories.runs,
    attachments: repositories.attachments,
    fileStore: repositories.fileStore,
    measurer: library.measurer,
    clock,
    ids,
  })
  const turnDeps = (signal: AbortSignal, emit: (event: AgentEvent) => void) => ({
    model,
    titleModel,
    registry,
    conversations: repositories.conversations,
    messages: repositories.messages,
    messageContexts: repositories.messageContexts,
    runs: repositories.runs,
    invocations: repositories.invocations,
    jobPostings: repositories.jobPostings,
    attachments: repositories.attachments,
    fileStore: repositories.fileStore,
    infoEntries: library.entries,
    customModules: library.customModules,
    resumes: library.resumes,
    changes: library.changes,
    measurer: library.measurer,
    clock,
    ids,
    emit,
    signal,
    secrets,
    maxOutputTokens,
    onWarning,
  })
  return {
    createConversation: (command) =>
      createConversation({ conversations: repositories.conversations, clock, ids }, command ?? {}),
    renameConversation: (command) =>
      renameConversation({ conversations: repositories.conversations, clock }, command),
    togglePinned: (command) =>
      togglePinned({ conversations: repositories.conversations, clock }, command),
    deleteConversation: (command) =>
      deleteConversation({ conversations: repositories.conversations }, command),
    listConversations: () =>
      listConversations({ conversations: repositories.conversations, clock }),
    listMessages: (conversationId, limit) =>
      repositories.messages.listByConversation(conversationId, limit),
    listMessageContexts: async (conversationId, limit) => {
      // The transcript view and the context chips are read together; chips only
      // exist on user turns, and the map skips turns that carry none.
      const messages = await repositories.messages.listByConversation(conversationId, limit)
      const contexts = new Map<MessageId, readonly MessageContext[]>()
      for (const message of messages) {
        if (message.kind !== 'user') continue
        const attached = await repositories.messageContexts.listByMessage(message.id)
        if (attached.length > 0) contexts.set(message.id, attached)
      }
      return contexts
    },
    appendMessage: (command) =>
      appendMessage(
        {
          conversations: repositories.conversations,
          messages: repositories.messages,
          messageContexts: repositories.messageContexts,
          attachments: repositories.attachments,
          clock,
          ids,
        },
        command,
      ),
    autoTitle: (command) =>
      autoTitleConversation(
        { conversations: repositories.conversations, model: titleModel, clock },
        command,
      ),
    ingestAttachment: (command) =>
      ingestAttachment(
        {
          attachments: repositories.attachments,
          fileStore: repositories.fileStore,
          clock,
          ids,
        },
        command,
      ),
    listAttachments: async (attachmentIds) => {
      if (attachmentIds.length === 0) return []
      const found = await repositories.attachments.listByIds(attachmentIds)
      const byId = new Map(found.map((attachment) => [attachment.id, attachment]))
      return attachmentIds.flatMap((id) => {
        const attachment = byId.get(id)
        return attachment === undefined ? [] : [attachment]
      })
    },
    readAttachmentBytes: async (attachmentId) => {
      const attachment = await repositories.attachments.findById(attachmentId)
      if (attachment === null) {
        throw new DomainError('attachmentNotFound', '找不到这个附件。', {
          entity: 'attachment',
          id: attachmentId,
          blockers: [attachmentId],
        })
      }
      return repositories.fileStore.read(attachment.storageName)
    },
    runTurn: (command, emit) =>
      activeRuns.run(command.conversationId, (signal) =>
        runAgentTurn(turnDeps(signal, emit), command),
      ),
    retryRun: (command, emit) =>
      activeRuns.run(command.conversationId, (signal) =>
        retryRun(turnDeps(signal, emit), command),
      ),
    cancelRun: (command) => cancelRun({ activeRuns }, command),
    parseJobPosting: (command) =>
      parseJobPosting(
        {
          model,
          jobPostings: repositories.jobPostings,
          runs: repositories.runs,
          clock,
          ids,
        },
        command,
      ),
    recoverInterruptedRuns: () =>
      recoverInterruptedRuns({
        runs: repositories.runs,
        messages: repositories.messages,
        clock,
      }),
  }
}

export interface ProviderFactoryOptions {
  readonly http: HttpClient
  readonly maxOutputTokens?: number
  readonly connectTimeoutMs?: number
}

/**
 * Builds the adapter for a provider row. The credential comes from the secure
 * store; the row only names the reference, so a missing credential is a
 * configuration state rather than a crash.
 */
export function createProviderFromConfig(
  config: ProviderConfig,
  apiKey: string,
  options: ProviderFactoryOptions,
): ModelProvider {
  const supportsImages = resolveImageSupport(config)
  if (config.kind === 'anthropic') {
    return new AnthropicProvider({
      id: config.id,
      modelId: config.modelId,
      baseUrl: config.baseUrl,
      apiKey,
      http: options.http,
      supportsImages,
      maxOutputTokens: options.maxOutputTokens,
      connectTimeoutMs: options.connectTimeoutMs,
    })
  }
  return new OpenAiCompatibleProvider({
    id: config.id,
    modelId: config.modelId,
    baseUrl: config.baseUrl,
    apiKey,
    http: options.http,
    supportsImages,
    maxOutputTokens: options.maxOutputTokens,
    connectTimeoutMs: options.connectTimeoutMs,
  })
}

export interface ResolveProviderDeps {
  readonly providerConfigs: ProviderConfigRepository
  readonly secrets: SecretStore
  readonly http: HttpClient
  readonly maxOutputTokens?: number
  readonly connectTimeoutMs?: number
}

/**
 * Reads the active provider row and its credential. No row, or a row whose
 * credential is missing, resolves to the unconfigured provider: the assistant
 * then explains what to configure instead of failing at the first token.
 */
export async function resolveActiveProvider(deps: ResolveProviderDeps): Promise<ModelProvider> {
  const config = await deps.providerConfigs.findActive()
  if (config === null) return new UnconfiguredModelProvider()
  const apiKey = await deps.secrets.load(config.secretRef)
  if (apiKey === null || apiKey === '') return new UnconfiguredModelProvider()
  return createProviderFromConfig(config, apiKey, {
    http: deps.http,
    maxOutputTokens: deps.maxOutputTokens,
    connectTimeoutMs: deps.connectTimeoutMs,
  })
}

/** The credential values the redactor needs; empty when the provider is unconfigured. */
export async function readActiveProviderSecret(deps: {
  readonly providerConfigs: ProviderConfigRepository
  readonly secrets: SecretStore
}): Promise<readonly string[]> {
  const config = await deps.providerConfigs.findActive()
  if (config === null) return []
  const apiKey = await deps.secrets.load(config.secretRef)
  return apiKey === null || apiKey === '' ? [] : [apiKey]
}

/** The context chips a message can carry, typed for the interface. */
export type { MessageContext }
