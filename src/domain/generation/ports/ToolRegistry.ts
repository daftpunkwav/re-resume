/**
 * @file ToolRegistry
 * @description The contract every agent tool implements, and the capabilities
 * handed to each execution.
 *
 * Responsibilities:
 * - Declare a registered tool: its identity, risk level, argument parser and
 *   executor
 * - Declare the registry the run loop consults: lookup, schema listing and the
 *   card label the interface shows
 * - Declare ToolContext, the capability set every tool execution receives
 *
 * Constraints:
 * - Argument parsing returns a Result rather than throwing: a malformed tool
 *   call is an expected outcome the model can correct, not a fault.
 * - `parse` must be strict. The registry only accepts what the tool declares;
 *   callers never pre-validate.
 * - ToolContext carries the run identity as a required member, so a write tool
 *   cannot execute without a run to attribute it to.
 */

import type { Result } from '../../shared/Result'
import type { Clock } from '../../shared/Clock'
import type { IdGenerator } from '../../shared/IdGenerator'
import type { AgentRunId, ConversationId } from '../../shared/branded-id'
import type { AgentEvent } from '../AgentEvent'
import type { ToolRisk } from '../ToolRisk'
import type { AttachmentRepository } from '../../conversation/ports/AttachmentRepository'
import type { ConversationRepository } from '../../conversation/ports/ConversationRepository'
import type { FileStore } from '../../conversation/ports/FileStore'
import type { MessageRepository } from '../../conversation/ports/MessageRepository'
import type { ChangeLogRepository } from '../../changes/ports/ChangeLogRepository'
import type { CustomModuleRepository } from '../../info/ports/CustomModuleRepository'
import type { InfoEntryRepository } from '../../info/ports/InfoEntryRepository'
import type { ResumeRepository } from '../../resume/ports/ResumeRepository'
import type { TextMeasurer } from '../../resume/ports/TextMeasurer'
import type { JobPostingRepository } from './JobPostingRepository'
import type { ToolSchema } from './ModelProvider'

export interface RegisteredTool<I, O> {
  readonly name: string
  readonly description: string
  readonly risk: ToolRisk
  /** Validates raw tool-call arguments at the boundary. */
  parse(raw: unknown): Result<I>
  execute(input: I, context: ToolContext): Promise<O>
}

/**
 * Capabilities handed to every tool execution. The conversation ports carry the
 * run's own state; the library, resume and change ports are the write channels
 * the tool pack uses, and the measurer is what the layout queries need.
 */
export interface ToolContext {
  readonly conversations: ConversationRepository
  readonly messages: MessageRepository
  readonly jobPostings: JobPostingRepository
  readonly attachments: AttachmentRepository
  readonly fileStore: FileStore
  readonly infoEntries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly resumes: ResumeRepository
  readonly changes: ChangeLogRepository
  readonly measurer: TextMeasurer
  readonly clock: Clock
  readonly ids: IdGenerator
  /** Required: every write a tool performs is attributed to this run. */
  readonly runId: AgentRunId
  readonly conversationId: ConversationId
  readonly emit: (event: AgentEvent) => void
}

export interface ToolRegistry {
  list(): readonly RegisteredTool<unknown, unknown>[]
  get(name: string): RegisteredTool<unknown, unknown> | undefined
  /** The schemas the model is allowed to call this run. */
  schemas(): readonly ToolSchema[]
  /** Chinese card label for a tool name; falls back to the name itself. */
  labelFor(name: string): string
}
