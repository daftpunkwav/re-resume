/**
 * @file fixtures
 * @description Starting values for the browser preview. They are deliberately
 * plain: a preview that already holds content would hide the empty states the
 * interface is expected to render on a fresh install.
 *
 * Constraints:
 * - Fixtures are values, not mutable singletons: every preview assembly builds
 *   its own repository around them.
 */

import { DEFAULT_APP_SETTINGS } from '../../domain/settings/AppSettings'
import type { AppSettings } from '../../domain/settings/AppSettings'
import type { ProviderConfig } from '../../domain/settings/ProviderConfig'
import { providerSecretRef } from '../../domain/settings/ProviderConfig'
import type { ModelChunk } from '../../domain/generation/ports/ModelProvider'
import { parseDateTime } from '../../domain/shared/DateTime'
import type { DateTime } from '../../domain/shared/DateTime'
import { PREVIEW_CONVERSATION_ID } from './fixtures.conversation'

const FIXTURE_TIME: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

/** Identifier of the one provider the preview starts with. */
export const PREVIEW_PROVIDER_ID = 'preview-provider-1'

/**
 * The model service the preview starts configured with. It points at a name
 * that never leaves the machine: the preview adapters are scripted, so the row
 * exists to render the configured list and the connection state, not to call out.
 */
export const PREVIEW_PROVIDERS: readonly ProviderConfig[] = [
  {
    id: PREVIEW_PROVIDER_ID,
    name: '示例模型服务',
    kind: 'openai-compatible',
    baseUrl: 'https://preview.example.com/v1',
    modelId: 'preview-scripted',
    secretRef: providerSecretRef(PREVIEW_PROVIDER_ID),
    supportsImages: false,
    isActive: true,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  },
]

/** The credential the fixture provider names; kept in the preview's memory only. */
export const PREVIEW_PROVIDER_CREDENTIAL = 'preview-credential-value'

/**
 * Preferences a screenshot session starts from. The colour scheme is pinned to
 * light so the preview does not depend on the machine it runs on; switching to
 * dark is a preview action, not an operating-system fact.
 */
export const PREVIEW_SETTINGS: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  colorScheme: 'light',
  activeProviderId: PREVIEW_PROVIDER_ID,
  lastConversationId: PREVIEW_CONVERSATION_ID,
}

/**
 * Minimal scripted answer: one Chinese paragraph streamed in a few deltas.
 * The full planning and composing scripts belong to the conversation work.
 */
export const PREVIEW_SCRIPT: readonly ModelChunk[] = [
  { type: 'text', textDelta: '收到。' },
  { type: 'text', textDelta: '我会先了解目标岗位，' },
  { type: 'text', textDelta: '再从简历信息里挑选合适的经历。' },
]

/** One frame the connection probe replays; enough to prove the pipe is open. */
export const PREVIEW_PROBE_SCRIPT: readonly ModelChunk[] = [
  { type: 'text', textDelta: 'pong' },
]
