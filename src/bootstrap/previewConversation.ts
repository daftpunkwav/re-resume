/**
 * @file previewConversation
 * @description Assembles the conversation service for the browser preview: the
 * in-memory repositories seeded from the fixtures, the scripted model, the
 * deterministic clock and identifier source, and the production use cases.
 *
 * Constraints:
 * - Preview assembly only. Nothing here reaches the disk, the network or the
 *   native container; the production bundle does not include this module.
 * - The production tool registry is empty, so the scripted model has no tools
 *   to call; the tool cards in the fixtures are pre-seeded history.
 * - `?script=slow|failure` selects the replay and the resulting run state. The
 *   option is read by the preview root, not here, so this assembly stays pure.
 */

import { buildToolRegistry } from '../application/generation/buildToolRegistry'
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
import { FakeClock, SequentialIdGenerator } from '../infrastructure/preview/deterministicEnvironment'
import {
  PREVIEW_CONVERSATION_SCRIPT,
  PREVIEW_CONVERSATIONS,
  PREVIEW_MESSAGES,
  PREVIEW_MESSAGE_CONTEXTS,
  PREVIEW_RUN,
  PREVIEW_TOOL_INVOCATION,
  PREVIEW_WRITE_TOOL_INVOCATION,
} from '../infrastructure/preview/fixtures.conversation'
import { ScriptedModelProvider } from '../infrastructure/preview/ScriptedModelProvider'
import type { ScriptedFailure } from '../infrastructure/preview/ScriptedModelProvider'
import type { ModelChunk } from '../domain/generation/ports/ModelProvider'
import { createConversationService } from './wiring/conversation'
import type { ConversationRepositories, ConversationService } from './wiring/conversation'

export interface PreviewConversationOptions {
  /** Chunks the scripted model replays for every request. */
  readonly script?: readonly ModelChunk[]
  /** Inter-chunk delay, used by the slow replay. */
  readonly pauseMs?: number
  /** Ends the replay with a provider failure, used by the failed-run preview. */
  readonly failure?: ScriptedFailure
}

export interface PreviewConversationAssembly {
  readonly service: ConversationService
  readonly activeRuns: ActiveRunRegistry
  /**
   * The repositories behind the service, so the sample-data seed can append to
   * the same conversation the window shows.
   */
  readonly repositories: ConversationRepositories
}

export function createPreviewConversationService(
  options: PreviewConversationOptions = {},
): PreviewConversationAssembly {
  const clock = new FakeClock()
  const ids = new SequentialIdGenerator('preview')
  const conversations = new InMemoryConversationRepository(PREVIEW_CONVERSATIONS)
  const runs = new InMemoryAgentRunRepository([PREVIEW_RUN])
  const messages = new InMemoryMessageRepository({
    messages: PREVIEW_MESSAGES,
    runs: runs.rows,
  })
  const activeRuns = new ActiveRunRegistry()
  const repositories: ConversationRepositories = {
    conversations,
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
  }
  const model = new ScriptedModelProvider({
    id: 'preview',
    modelId: 'preview-scripted',
    supportsImages: false,
    script: options.script ?? PREVIEW_CONVERSATION_SCRIPT,
    pauseMs: options.pauseMs,
    failure: options.failure,
  })
  const service = createConversationService({
    repositories,
    clock,
    ids,
    model,
    titleModel: null,
    activeRuns,
    secrets: [],
    registry: buildToolRegistry(),
    onWarning: (message, warning) => {
      console.warn(`[preview] ${message}`, warning)
    },
  })
  return { service, activeRuns, repositories }
}
