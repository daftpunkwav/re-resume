/**
 * @file AddVariant
 * @description Adds one job-facing wording of an experience. A variant holds no
 * fact fields, so this command cannot change the facts it describes.
 *
 * Responsibilities:
 * - Validate the wording fields the user typed
 * - Decide whether the new variant starts confirmed or unconfirmed
 *
 * Constraints:
 * - A user-authored variant is confirmed on creation; one carrying a drafting
 *   run id stays unconfirmed and therefore unreferenceable until ConfirmVariant
 *   runs (section 3.5 invariant 6).
 * - A duplicate label is an aggregate invariant and comes back as a
 *   DomainError, not as an Err.
 */

import { z } from 'zod'
import { addVariant as addVariantAggregate } from '../../domain/catalog/Experience'
import type { Experience } from '../../domain/catalog/Experience'
import type { Clock } from '../../domain/shared/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import { asAgentRunId, asExperienceId, asVariantId } from '../../domain/shared/branded-id'
import type { AgentRunId } from '../../domain/shared/branded-id'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import { err, ok } from '../../domain/shared/Result'
import type { Result } from '../../domain/shared/Result'

/** A cleared form field arrives as '', which means "no emphasis". */
const optionalEmphasis = z
  .union([z.literal(''), z.string().trim().min(1)])
  .transform((raw) => (raw === '' ? null : raw))
  .nullable()
  .optional()

const addVariantCommandSchema = z.object({
  experienceId: z.string().min(1),
  label: z.string().trim().min(1),
  content: z.string().trim().min(1),
  emphasis: optionalEmphasis,
  draftedByRunId: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .transform((raw) => (raw === undefined || raw === null ? null : asAgentRunId(raw))),
})

export interface AddVariantDeps {
  readonly experienceRepo: ExperienceRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface AddVariantCommand {
  readonly experienceId: string
  /** Short identifier of intended use, unique within the experience. */
  readonly label: string
  readonly content: string
  readonly emphasis?: string | null
  /** Set when an agent run drafted this variant; null for user-authored. */
  readonly draftedByRunId?: AgentRunId | null
}

export async function addVariant(
  deps: AddVariantDeps,
  command: AddVariantCommand,
): Promise<Result<Experience, z.ZodError>> {
  const parsed = addVariantCommandSchema.safeParse(command)
  if (!parsed.success) return err(parsed.error)
  const { experienceId, label, content, emphasis, draftedByRunId } = parsed.data

  const experience = await deps.experienceRepo.findById(asExperienceId(experienceId))
  if (experience === null) {
    throw new Error(`Cannot add a variant to experience "${experienceId}": no such experience.`)
  }

  const now = deps.clock.now()
  const updated = addVariantAggregate(
    experience,
    {
      id: asVariantId(deps.ids.next()),
      label,
      content,
      emphasis: emphasis ?? null,
      draftedByRunId,
      confirmedAt: draftedByRunId === null ? now : null,
    },
    now,
  )
  await deps.experienceRepo.save(updated)
  return ok(updated)
}
