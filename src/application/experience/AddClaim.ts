/**
 * @file AddClaim
 * @description Records one checkable assertion about an experience: a metric, a
 * responsibility or a skill, together with where it came from. A number in a
 * resume has to point at a row here, which is what makes "the AI did not invent
 * this" checkable.
 *
 * Responsibilities:
 * - Validate the assertion text and its kind
 * - Store the assertion as pending
 *
 * Constraints:
 * - A new assertion is always pending. ConfirmClaim's only legal source state
 *   is pending, so a claim created as confirmed could never be confirmed, and
 *   creating one as rejected would make it unreferenceable before review.
 * - Wording is immutable afterwards; changing it means rejecting this claim and
 *   adding a new one. There is no update path here on purpose.
 * - A statement already active on this experience comes back as a DomainError;
 *   a rejected wording does not hold the key, so it can be added again.
 */

import { z } from 'zod'
import { addClaim as addClaimAggregate } from '../../domain/catalog/Experience'
import type { Experience } from '../../domain/catalog/Experience'
import { CLAIM_KINDS } from '../../domain/catalog/ClaimKind'
import type { ClaimKind } from '../../domain/catalog/ClaimKind'
import type { Clock } from '../../domain/catalog/ports/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import { asClaimId, asExperienceId } from '../../domain/shared/branded-id'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import { err, ok } from '../../domain/shared/Result'
import type { Result } from '../../domain/shared/Result'

const addClaimCommandSchema = z.object({
  experienceId: z.string().min(1),
  kind: z.enum(CLAIM_KINDS),
  statement: z.string().trim().min(1),
  /** Which fact field the assertion derives from, e.g. "detail.highlights.0". */
  sourceField: z.string().trim().min(1).nullable().optional(),
})

export interface AddClaimDeps {
  readonly experienceRepo: ExperienceRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface AddClaimCommand {
  readonly experienceId: string
  readonly kind: ClaimKind
  readonly statement: string
  readonly sourceField?: string | null
}

export async function addClaim(
  deps: AddClaimDeps,
  command: AddClaimCommand,
): Promise<Result<Experience, z.ZodError>> {
  const parsed = addClaimCommandSchema.safeParse(command)
  if (!parsed.success) return err(parsed.error)
  const { experienceId, kind, statement, sourceField } = parsed.data

  const experience = await deps.experienceRepo.findById(asExperienceId(experienceId))
  if (experience === null) {
    throw new Error(`Cannot add a claim to experience "${experienceId}": no such experience.`)
  }

  const updated = addClaimAggregate(
    experience,
    {
      id: asClaimId(deps.ids.next()),
      kind,
      statement,
      sourceField: sourceField ?? null,
      status: 'pending',
    },
    deps.clock.now(),
  )
  await deps.experienceRepo.save(updated)
  return ok(updated)
}
