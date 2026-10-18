/**
 * @file ConfirmClaim
 * @description Moves one assertion from pending to confirmed, recording that
 * the user checked it against the source.
 *
 * Responsibilities:
 * - Apply the pending -> confirmed transition and persist the aggregate
 *
 * Constraints:
 * - No other transition is legal from here; an illegal move comes back as an
 *   invalidClaimTransition DomainError rather than being silently ignored.
 * - Confirmation changes no version. Staleness at claim level is derived by
 *   comparing a block's claimIds against current claim states, so a confirmed
 *   assertion must not mark blocks stale.
 */

import { confirmClaim as confirmClaimAggregate } from '../../domain/catalog/Experience'
import type { Experience } from '../../domain/catalog/Experience'
import type { Clock } from '../../domain/shared/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ClaimId, ExperienceId } from '../../domain/shared/branded-id'

export interface ConfirmClaimDeps {
  readonly experienceRepo: ExperienceRepository
  readonly clock: Clock
}

export async function confirmClaim(
  deps: ConfirmClaimDeps,
  experienceId: ExperienceId,
  claimId: ClaimId,
): Promise<Experience> {
  const experience = await deps.experienceRepo.findById(experienceId)
  if (experience === null) {
    throw new Error(`Cannot confirm a claim of experience "${experienceId}": no such experience.`)
  }

  const updated = confirmClaimAggregate(experience, claimId, deps.clock.now())
  await deps.experienceRepo.save(updated)
  return updated
}
