/**
 * @file previewConversation
 * @description Assembles the conversation service for the browser preview: the
 * in-memory repositories seeded from the fixtures, the scripted model, the
 * deterministic clock and identifier source, and the production use cases.
 *
 * Responsibilities:
 * - Build one preview state (repositories, clock, ids) that the conversation,
 *   the library panel and the resume panel can share
 * - Assemble the library ports the tool pack writes through, so a scripted tool
 *   call changes what the panels show
 * - Keep an isolated state for tests and stubs that need only the conversation
 *
 * Constraints:
 * - Preview assembly only. Nothing here reaches the disk, the network or the
 *   native container; the production bundle does not include this module.
 * - `?script=slow|failure` selects the replay and the resulting run state. The
 *   option is read by the preview root, not here, so this assembly stays pure.
 */

import { ActiveRunRegistry } from '../application/generation/activeRunRegistry'
import { InMemoryFileStore } from '../infrastructure/preview/InMemoryFileStore'
import {
  InMemoryAgentRunRepository,
  InMemoryAttachmentRepository,
  InMemoryConversationRepository,
  InMemoryJobPostingRepository,
  InMemoryMessageContextRepository,
  InMemoryMessageRepository,
  InMemoryToolInvocationRepository,
} from '../infrastructure/preview/inMemoryConversationRepositories'
import {
  InMemoryChangeLogRepository,
  InMemoryCustomModuleRepository,
  InMemoryInfoEntryRepository,
} from '../infrastructure/preview/inMemoryInfoRepositories'
import { InMemoryResumeRepository } from '../infrastructure/preview/inMemoryResumeRepository'
import { ResumeEntryReferences } from '../infrastructure/persistence/resume/ResumeEntryReferences'
import { FixtureTextMeasurer } from '../infrastructure/measurement/FixtureTextMeasurer'
import { FakeClock, SequentialIdGenerator } from '../infrastructure/preview/deterministicEnvironment'
import {
  PREVIEW_CHANGE_RECORD,
  PREVIEW_CONVERSATIONS,
  PREVIEW_MESSAGES,
  PREVIEW_MESSAGE_CONTEXTS,
  PREVIEW_RUN,
  PREVIEW_TOOL_INVOCATION,
  PREVIEW_VISION_SCRIPT,
  PREVIEW_WRITE_TOOL_INVOCATION,
} from '../infrastructure/preview/fixtures.conversation'
import {
  PREVIEW_INFO_CUSTOM_MODULES,
  PREVIEW_INFO_ENTRIES,
} from '../infrastructure/preview/fixtures.info'
import { PREVIEW_RESUMES } from '../infrastructure/preview/fixtures.resume'
import { ScriptedModelProvider } from '../infrastructure/preview/ScriptedModelProvider'
import type {
  ScriptedFailure,
  ScriptedTurn,
} from '../infrastructure/preview/ScriptedModelProvider'
import type {
  ChatRequest,
  ModelChunk,
} from '../domain/generation/ports/ModelProvider'
import type { TextMeasurer } from '../domain/resume/ports/TextMeasurer'
import type { ConversationLibrary } from './wiring/conversation'
import { createConversationService } from './wiring/conversation'
import type { ConversationService } from './wiring/conversation'

/** The memory repositories one preview window keeps for its whole lifetime. */
export interface PreviewConversationState {
  readonly clock: FakeClock
  readonly ids: SequentialIdGenerator
  readonly conversations: InMemoryConversationRepository
  readonly messages: InMemoryMessageRepository
  readonly messageContexts: InMemoryMessageContextRepository
  readonly attachments: InMemoryAttachmentRepository
  readonly jobPostings: InMemoryJobPostingRepository
  readonly runs: InMemoryAgentRunRepository
  readonly invocations: InMemoryToolInvocationRepository
  readonly fileStore: InMemoryFileStore
  readonly entries: InMemoryInfoEntryRepository
  readonly customModules: InMemoryCustomModuleRepository
  readonly changes: InMemoryChangeLogRepository
  readonly resumes: InMemoryResumeRepository
  readonly measurer: TextMeasurer
}

/** Creates the seeded memory state: library, resumes, one conversation and its run. */
export function createPreviewConversationState(): PreviewConversationState {
  const clock = new FakeClock()
  const ids = new SequentialIdGenerator('preview')
  const changes = new InMemoryChangeLogRepository([PREVIEW_CHANGE_RECORD])
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  entries.seed(PREVIEW_INFO_ENTRIES)
  customModules.seed(PREVIEW_INFO_CUSTOM_MODULES)
  const resumes = new InMemoryResumeRepository(clock)
  resumes.seed(PREVIEW_RESUMES)
  const runs = new InMemoryAgentRunRepository([PREVIEW_RUN])
  const messages = new InMemoryMessageRepository({
    messages: PREVIEW_MESSAGES,
    runs: runs.rows,
  })
  return {
    clock,
    ids,
    conversations: new InMemoryConversationRepository(PREVIEW_CONVERSATIONS),
    messages,
    messageContexts: new InMemoryMessageContextRepository(PREVIEW_MESSAGE_CONTEXTS),
    attachments: new InMemoryAttachmentRepository(),
    jobPostings: new InMemoryJobPostingRepository(),
    runs,
    invocations: new InMemoryToolInvocationRepository([
      PREVIEW_TOOL_INVOCATION,
      PREVIEW_WRITE_TOOL_INVOCATION,
    ]),
    fileStore: new InMemoryFileStore(),
    entries,
    customModules,
    changes,
    resumes,
    measurer: new FixtureTextMeasurer(),
  }
}

/** The library ports the tool pack writes through, over one memory state. */
export function createPreviewLibrary(state: PreviewConversationState): ConversationLibrary {
  return {
    entries: state.entries,
    customModules: state.customModules,
    references: new ResumeEntryReferences(state.resumes),
    resumes: state.resumes,
    changes: state.changes,
    measurer: state.measurer,
  }
}

export interface PreviewConversationOptions {
  /** Chunks the scripted model replays for every request. */
  readonly script?: readonly ModelChunk[]
  /** Per-request scripts, replayed in order; overrides `script` when present. */
  readonly turns?: readonly ScriptedTurn[]
  /** Inter-chunk delay, used by the slow replay. */
  readonly pauseMs?: number
  /** Ends the replay with a provider failure, used by the failed-run preview. */
  readonly failure?: ScriptedFailure
  /** Shared memory state; a fresh seeded state is built when omitted. */
  readonly state?: PreviewConversationState
}

/** True when a request carries an image part, which the preview answers specially. */
function requestHasImage(request: ChatRequest): boolean {
  return request.messages.some((message) =>
    message.parts.some((part) => part.kind === 'image'),
  )
}

/**
 * Answers any request that carries a screenshot with the vision script, so the
 * preview shows the multimodal path instead of a scripted tool chain that never
 * looked at the image. Other requests keep their per-request replay.
 */
function turnsWithVisionAnswer(
  turns: readonly ScriptedTurn[],
): readonly ScriptedTurn[] {
  return turns.map(
    (turn): ScriptedTurn =>
      (request, requestIndex) =>
        requestHasImage(request)
          ? PREVIEW_VISION_SCRIPT
          : typeof turn === 'function'
            ? turn(request, requestIndex)
            : turn,
  )
}

export interface PreviewConversationAssembly {
  readonly service: ConversationService
  readonly activeRuns: ActiveRunRegistry
  readonly state: PreviewConversationState
}

export function createPreviewConversationService(
  options: PreviewConversationOptions = {},
): PreviewConversationAssembly {
  const state = options.state ?? createPreviewConversationState()
  const activeRuns = new ActiveRunRegistry()
  const model = new ScriptedModelProvider({
    id: 'preview',
    modelId: 'preview-scripted',
    supportsImages: true,
    script: options.script ?? [],
    turns:
      options.turns === undefined ? undefined : turnsWithVisionAnswer(options.turns),
    pauseMs: options.pauseMs,
    failure: options.failure,
  })
  const service = createConversationService({
    repositories: {
      conversations: state.conversations,
      messages: state.messages,
      messageContexts: state.messageContexts,
      attachments: state.attachments,
      jobPostings: state.jobPostings,
      runs: state.runs,
      invocations: state.invocations,
      fileStore: state.fileStore,
    },
    library: createPreviewLibrary(state),
    clock: state.clock,
    ids: state.ids,
    model,
    titleModel: null,
    activeRuns,
    secrets: [],
    onWarning: (message, warning) => {
      console.warn(`[preview] ${message}`, warning)
    },
  })
  return { service, activeRuns, state }
}
