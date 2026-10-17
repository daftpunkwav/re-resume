/**
 * @file ConfirmVariant
 * @description Records the user's confirmation of a drafted variant. The
 * drafting run stays on the row, so "which run wrote this and when did the user
 * accept it" stays answerable.
 *
 * Responsibilities:
 * - Write confirmedAt on the named variant and persist the aggregate
 *
 * Constraints:
 * - This writes no content and bumps no version. factVersion is the signal
 *   that an experience's facts or its variant set moved on; a confirmation is
 *   neither, and bumping it would mark every block that references this
 *   experience stale, including those using a different variant.
 */

import { confirmVariantDraft } from '../../domain/catalog/Experience'
import type { Experience } from '../../domain/catalog/Experience'
import type { Clock } from '../../domain/shared/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ExperienceId, VariantId } from '../../domain/shared/branded-id'

export interface ConfirmVariantDeps {
  readonly experienceRepo: ExperienceRepository
  readonly clock: Clock
}

export async function confirmVariant(
  deps: ConfirmVariantDeps,
  experienceId: ExperienceId,
  variantId: VariantId,
): Promise<Experience> {
  const experience = await deps.experienceRepo.findById(experienceId)
  if (experience === null) {
    throw new Error(`Cannot confirm a variant of experience "${experienceId}": no such experience.`)
  }

  const updated = confirmVariantDraft(experience, variantId, deps.clock.now())
  await deps.experienceRepo.save(updated)
  return updated
}
