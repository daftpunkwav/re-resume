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
 *   to call; the tool card in the fixtures is pre-seeded history.
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
  PREVIEW_CONVERSATION,
  PREVIEW_CONVERSATION_SCRIPT,
  PREVIEW_MESSAGES,
  PREVIEW_RUN,
  PREVIEW_TOOL_INVOCATION,
} from '../infrastructure/preview/fixtures.conversation'
import { ScriptedModelProvider } from '../infrastructure/preview/ScriptedModelProvider'
import { createConversationService } from './wiring/conversation'
import type { ConversationService } from './wiring/conversation'

export interface PreviewConversationAssembly {
  readonly service: ConversationService
  readonly activeRuns: ActiveRunRegistry
}

export function createPreviewConversationService(): PreviewConversationAssembly {
  const clock = new FakeClock()
  const ids = new SequentialIdGenerator('preview')
  const conversations = new InMemoryConversationRepository([PREVIEW_CONVERSATION])
  const runs = new InMemoryAgentRunRepository([PREVIEW_RUN])
  const messages = new InMemoryMessageRepository({
    messages: PREVIEW_MESSAGES,
    runs: runs.rows,
  })
  const activeRuns = new ActiveRunRegistry()
  const model = new ScriptedModelProvider({
    id: 'preview',
    modelId: 'preview-scripted',
    supportsImages: false,
    script: PREVIEW_CONVERSATION_SCRIPT,
  })
  const service = createConversationService({
    repositories: {
      conversations,
      messages,
      messageContexts: new InMemoryMessageContextRepository(),
      attachments: new InMemoryAttachmentRepository(),
      jobPostings: new InMemoryJobPostingRepository(),
      runs,
      invocations: new InMemoryToolInvocationRepository([PREVIEW_TOOL_INVOCATION]),
      fileStore: new InMemoryFileStore(),
    },
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
  return { service, activeRuns }
}
