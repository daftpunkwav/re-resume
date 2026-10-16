/**
 * @file ReopenClaim
 * @description Moves one rejected assertion back to pending, which is the way to
 * revive a wording that is still wanted.
 *
 * Responsibilities:
 * - Apply the rejected -> pending transition and persist the aggregate
 *
 * Constraints:
 * - Reopening restores the old row rather than creating a new claim. If the
 *   rejection was a mistake this is the cheaper path; if the wording should
 *   come back after a rejection while other claims took its place, the active
 *   statement uniqueness decides whether reopening or a new claim is allowed.
 */

import { reopenClaim as reopenClaimAggregate } from '../../domain/catalog/Experience'
import type { Experience } from '../../domain/catalog/Experience'
import type { Clock } from '../../domain/catalog/ports/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ClaimId, ExperienceId } from '../../domain/shared/branded-id'

export interface ReopenClaimDeps {
  readonly experienceRepo: ExperienceRepository
  readonly clock: Clock
}

export async function reopenClaim(
  deps: ReopenClaimDeps,
  experienceId: ExperienceId,
  claimId: ClaimId,
): Promise<Experience> {
  const experience = await deps.experienceRepo.findById(experienceId)
  if (experience === null) {
    throw new Error(`Cannot reopen a claim of experience "${experienceId}": no such experience.`)
  }

  const updated = reopenClaimAggregate(experience, claimId, deps.clock.now())
  await deps.experienceRepo.save(updated)
  return updated
}
