/**
 * @file ResumeOverride
 * @description Resume-level customised text: one summary written for a specific
 * job, or a rewritten body for one library entry. Overrides are what makes a
 * resume tailored without editing the shared facts; the origin marker keeps
 * agent-written text distinguishable, and `editedByUser` records that a person
 * took it over.
 *
 * Responsibilities:
 * - Declare the targets, the text bounds and the provenance rules
 * - Validate the collection invariants: one summary, one override per entry
 * - Provide the target lookup the write use cases and the renderer share
 *
 * Constraints:
 * - An entry override may target an entry that no longer exists: the override is
 *   kept so restoring the entry restores the text, and reported as a missing
 *   reference instead of being deleted.
 * - Pure data: no DOM, no storage, no package.
 */

import type { AgentRunId, InfoEntryId, ResumeOverrideId } from '../shared/branded-id'
import { DomainError } from '../shared/DomainError'
import type { ChangeOrigin } from './DocumentState'
import type { DateTime } from '../shared/DateTime'
import { countCodePoints } from '../info/codePoints'

/** Longest accepted summary text, in code points. */
export const SUMMARY_OVERRIDE_MAX_LENGTH = 4000

/** Longest accepted entry override text, in code points. */
export const ENTRY_OVERRIDE_MAX_LENGTH = 2000

export type OverrideTarget =
  | { readonly kind: 'summary' }
  | { readonly kind: 'entry'; readonly entryId: InfoEntryId }

export interface ResumeOverride {
  readonly id: ResumeOverrideId
  readonly target: OverrideTarget
  readonly text: string
  readonly origin: ChangeOrigin
  /** Non-null exactly when the origin is 'agent'. */
  readonly sourceRunId: AgentRunId | null
  /** True once a user edited text the agent wrote. */
  readonly editedByUser: boolean
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

/** Identity the uniqueness rules are stated on. */
export function overrideTargetKey(target: OverrideTarget): string {
  return target.kind === 'summary' ? 'summary' : `entry:${target.entryId}`
}

function overrideError(
  code: 'overrideLimit' | 'fieldTooLong' | 'invalidFieldValue',
  message: string,
  id: string,
  blockers: readonly string[] = [],
): DomainError {
  return new DomainError(code, message, { entity: 'resumeOverride', id, blockers })
}

/** Length bound of the text a target accepts. */
export function overrideTextLimit(target: OverrideTarget): number {
  return target.kind === 'summary' ? SUMMARY_OVERRIDE_MAX_LENGTH : ENTRY_OVERRIDE_MAX_LENGTH
}

/**
 * Validates one override: identifier, provenance, timestamps and text length.
 *
 * @throws DomainError `fieldTooLong` for over-long text, `invalidFieldValue`
 *   for a provenance combination the model does not allow.
 */
export function assertOverride(override: ResumeOverride): void {
  if (override.target.kind === 'entry' && override.target.entryId === '') {
    throw overrideError('invalidFieldValue', 'An entry override must name an entry.', override.id)
  }
  if (override.origin !== 'user' && override.origin !== 'agent') {
    throw overrideError('invalidFieldValue', 'An override origin must be user or agent.', override.id)
  }
  if (override.origin === 'agent' && override.sourceRunId === null) {
    throw overrideError(
      'invalidFieldValue',
      'An agent-written override must name the run that wrote it.',
      override.id,
      ['sourceRunId'],
    )
  }
  if (override.origin === 'user' && override.sourceRunId !== null) {
    throw overrideError(
      'invalidFieldValue',
      'A user-written override carries no source run.',
      override.id,
      ['sourceRunId'],
    )
  }
  if (override.text.trim() === '') {
    throw overrideError('invalidFieldValue', 'An override needs text.', override.id)
  }
  if (countCodePoints(override.text) > overrideTextLimit(override.target)) {
    throw overrideError(
      'fieldTooLong',
      `This override may be at most ${overrideTextLimit(override.target).toString()} characters.`,
      override.id,
      [override.id],
    )
  }
}

/**
 * Validates the identity rules of a renderable collection: unique override ids,
 * one summary, and one entry override per entry.
 *
 * @throws DomainError `overrideLimit` for a duplicated target.
 */
export function assertOverrideCollection(overrides: readonly ResumeOverride[]): void {
  const ids = new Set<string>()
  const targets = new Set<string>()
  for (const override of overrides) {
    assertOverride(override)
    if (ids.has(override.id)) {
      throw overrideError('invalidFieldValue', 'An override id appears twice.', override.id, [
        override.id,
      ])
    }
    ids.add(override.id)
    const key = overrideTargetKey(override.target)
    if (targets.has(key)) {
      throw overrideError(
        'overrideLimit',
        'A resume holds at most one override for one target.',
        override.id,
        [key],
      )
    }
    targets.add(key)
  }
}

/** The override written for a target, if any. */
export function findOverrideByTarget(
  overrides: readonly ResumeOverride[],
  target: OverrideTarget,
): ResumeOverride | undefined {
  const key = overrideTargetKey(target)
  return overrides.find((override) => overrideTargetKey(override.target) === key)
}

/** Replaces the override of the same target in place, or appends the new one. */
export function replaceOverride(
  overrides: readonly ResumeOverride[],
  override: ResumeOverride,
): readonly ResumeOverride[] {
  const key = overrideTargetKey(override.target)
  const index = overrides.findIndex((entry) => overrideTargetKey(entry.target) === key)
  if (index === -1) return [...overrides, override]
  return overrides.map((entry, position) => (position === index ? override : entry))
}
