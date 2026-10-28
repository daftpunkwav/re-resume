/**
 * @file imageSupport
 * @description Whether a provider configuration can accept image parts. The
 * provider row can override the answer; this is the fallback used when it does
 * not: Anthropic's message models all accept images, while the older OpenAI
 * text models do not.
 *
 * Constraints:
 * - A heuristic, so the settings form lets the user override it. The adapter
 *   property comes from the resolved answer, not from this function directly.
 */

import type { ProviderKind } from '../../../domain/settings/ProviderConfig'

/** Model-name prefixes of OpenAI-compatible models without image input. */
const TEXT_ONLY_MODEL_PATTERN = /^(gpt-3\.5|text-|o1-mini)/i

export function inferImageSupport(kind: ProviderKind, modelId: string): boolean {
  if (kind === 'anthropic') return true
  return !TEXT_ONLY_MODEL_PATTERN.test(modelId)
}
