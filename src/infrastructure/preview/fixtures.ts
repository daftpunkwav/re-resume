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
import type { ModelChunk } from '../../domain/generation/ports/ModelProvider'

/**
 * Preferences a screenshot session starts from. The colour scheme is pinned to
 * light so the preview does not depend on the machine it runs on; switching to
 * dark is a preview action, not an operating-system fact.
 */
export const PREVIEW_SETTINGS: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  colorScheme: 'light',
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
