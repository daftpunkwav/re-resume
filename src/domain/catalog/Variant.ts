/**
 * @file Variant
 * @description A job-facing rewrite of one experience. Variants deliberately
 * carry no fact fields, so rewriting a description has no path to the facts.
 * All mutation goes through the Experience aggregate, which owns the rules.
 *
 * Constraints:
 * - draftedByRunId survives confirmation; provenance is never erased.
 */

import type { DateTime } from '../shared/DateTime'
import type { AgentRunId, ExperienceId, VariantId } from '../shared/branded-id'

export interface Variant {
  readonly id: VariantId
  readonly experienceId: ExperienceId
  /** Short identifier of intended use, e.g. "架构导向" or "业务价值导向". */
  readonly label: string
  readonly content: string
  readonly emphasis: string | null
  /** Run that drafted this variant; null for user-authored variants. */
  readonly draftedByRunId: AgentRunId | null
  /** Null until the user confirms a drafted variant. */
  readonly confirmedAt: DateTime | null
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

export interface VariantInput {
  readonly id: VariantId
  readonly label: string
  readonly content: string
  readonly emphasis: string | null
  readonly draftedByRunId: AgentRunId | null
  readonly confirmedAt: DateTime | null
}

export interface VariantPatch {
  readonly label?: string
  readonly content?: string
  readonly emphasis?: string | null
}

/** Derived, not stored: unconfirmed draft iff drafted by a run and not confirmed. */
export function isUnconfirmedDraft(variant: Variant): boolean {
  return variant.draftedByRunId !== null && variant.confirmedAt === null
}
