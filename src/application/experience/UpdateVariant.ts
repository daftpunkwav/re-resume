/**
 * @file UpdateVariant
 * @description Rewrites the wording of an existing variant. The patch carries
 * label, content and emphasis only, so editing a description has no path to
 * the facts the variant describes.
 *
 * Responsibilities:
 * - Validate the replacement wording
 * - Persist the aggregate carrying the rewritten variant
 *
 * Constraints:
 * - Confirmation state is not editable here: confirmedAt and draftedByRunId
 *   belong to ConfirmVariant and to the drafting tool respectively.
 * - A duplicate label is an aggregate invariant and comes back as a
 *   DomainError, not as an Err.
 */

import { z } from 'zod'
import { updateVariant as updateVariantAggregate } from '../../domain/catalog/Experience'
import type { Experience } from '../../domain/catalog/Experience'
import type { VariantPatch } from '../../domain/catalog/Variant'
import type { Clock } from '../../domain/shared/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import { asExperienceId, asVariantId } from '../../domain/shared/branded-id'
import { err, ok } from '../../domain/shared/Result'
import type { Result } from '../../domain/shared/Result'

const optionalEmphasis = z
  .union([z.literal(''), z.string().trim().min(1)])
  .transform((raw) => (raw === '' ? null : raw))
  .nullable()
  .optional()

const updateVariantCommandSchema = z.object({
  experienceId: z.string().min(1),
  variantId: z.string().min(1),
  label: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
  emphasis: optionalEmphasis,
})

export interface UpdateVariantDeps {
  readonly experienceRepo: ExperienceRepository
  readonly clock: Clock
}

export interface UpdateVariantCommand {
  readonly experienceId: string
  readonly variantId: string
  readonly label?: string
  readonly content?: string
  readonly emphasis?: string | null
}

export async function updateVariant(
  deps: UpdateVariantDeps,
  command: UpdateVariantCommand,
): Promise<Result<Experience, z.ZodError>> {
  const parsed = updateVariantCommandSchema.safeParse(command)
  if (!parsed.success) return err(parsed.error)
  const { experienceId, variantId, label, content, emphasis } = parsed.data

  const experience = await deps.experienceRepo.findById(asExperienceId(experienceId))
  if (experience === null) {
    throw new Error(`Cannot update a variant of experience "${experienceId}": no such experience.`)
  }

  // An omitted field keeps its current value; the aggregate reads undefined
  // as unchanged, and emphasis is the one field that can be set back to null.
  const patch: VariantPatch = { label, content, emphasis }
  const updated = updateVariantAggregate(
    experience,
    asVariantId(variantId),
    patch,
    deps.clock.now(),
  )
  await deps.experienceRepo.save(updated)
  return ok(updated)
}
