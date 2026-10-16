/**
 * @file RejectClaim
 * @description Marks one assertion as rejected, so it can never be referenced
 * by a resume block again.
 *
 * Responsibilities:
 * - Apply the pending -> rejected or confirmed -> rejected transition
 * - Persist the experience aggregate, and nothing else
 *
 * Constraints:
 * - This use case writes one aggregate. It does not scan or rewrite resumes:
 *   staleness is derived on demand by comparing a block's claimIds against
 *   current claim states, so there is no second truth to keep in step here.
 * - Once rejected, the wording no longer holds the uniqueness key, so adding
 *   the same statement again creates a new claim instead of colliding.
 */

import { rejectClaim as rejectClaimAggregate } from '../../domain/catalog/Experience'
import type { Experience } from '../../domain/catalog/Experience'
import type { Clock } from '../../domain/catalog/ports/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ClaimId, ExperienceId } from '../../domain/shared/branded-id'

export interface RejectClaimDeps {
  readonly experienceRepo: ExperienceRepository
  readonly clock: Clock
}

export async function rejectClaim(
  deps: RejectClaimDeps,
  experienceId: ExperienceId,
  claimId: ClaimId,
): Promise<Experience> {
  const experience = await deps.experienceRepo.findById(experienceId)
  if (experience === null) {
    throw new Error(`Cannot reject a claim of experience "${experienceId}": no such experience.`)
  }

  const updated = rejectClaimAggregate(experience, claimId, deps.clock.now())
  await deps.experienceRepo.save(updated)
  return updated
}
