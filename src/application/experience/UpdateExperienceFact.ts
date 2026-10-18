/**
 * @file UpdateExperienceFact
 * @description Edits the fact fields of one experience: title, organization,
 * dates and the kind-specific detail record. Variants and claims are separate
 * use cases so that a factual edit never touches them.
 *
 * Responsibilities:
 * - Validate the patch shape and, when detail is present, the record for the
 *   experience's own kind
 * - Persist the patched aggregate
 *
 * Constraints:
 * - Argument-shape problems return an Err; date and title invariants come back
 *   as a DomainError thrown by the aggregate.
 * - Every write bumps factVersion, which is what marks referencing resume
 *   blocks stale; see invariant 6 of the aggregate.
 */

import { z } from 'zod'
import { updateFact } from '../../domain/catalog/Experience'
import type { Experience, FactPatch } from '../../domain/catalog/Experience'
import type { Clock } from '../../domain/shared/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import { parseIsoDate } from '../../domain/shared/DateTime'
import { asExperienceId } from '../../domain/shared/branded-id'
import { err, ok } from '../../domain/shared/Result'
import type { Result } from '../../domain/shared/Result'
import type { ExperienceDetailError } from '../catalog/experienceDetailSchemas'
import { parseExperienceDetail } from '../catalog/experienceDetailSchemas'

const isoDateInput = z
  .string()
  .transform((raw, ctx) => {
    const parsed = parseIsoDate(raw)
    if (parsed === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Expected a real ISO calendar date formatted as YYYY-MM-DD.',
      })
      return z.NEVER
    }
    return parsed
  })

const updateExperienceFactCommandSchema = z.object({
  experienceId: z.string().min(1),
  title: z.string().trim().optional(),
  organization: z.string().trim().min(1).nullable().optional(),
  startDate: isoDateInput.nullable().optional(),
  endDate: isoDateInput.nullable().optional(),
  isCurrent: z.boolean().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
})

export interface UpdateExperienceFactDeps {
  readonly experienceRepo: ExperienceRepository
  readonly clock: Clock
}

export interface UpdateExperienceFactCommand {
  readonly experienceId: string
  readonly title?: string
  readonly organization?: string | null
  readonly startDate?: string | null
  readonly endDate?: string | null
  readonly isCurrent?: boolean
  readonly detail?: Readonly<Record<string, unknown>>
}

export async function updateExperienceFact(
  deps: UpdateExperienceFactDeps,
  command: UpdateExperienceFactCommand,
): Promise<Result<Experience, ExperienceDetailError>> {
  const parsed = updateExperienceFactCommandSchema.safeParse(command)
  if (!parsed.success) return err(parsed.error)
  const { experienceId, title, organization, startDate, endDate, isCurrent, detail } =
    parsed.data

  const experience = await deps.experienceRepo.findById(asExperienceId(experienceId))
  if (experience === null) {
    throw new Error(`Cannot update experience "${experienceId}": no such experience.`)
  }

  let patchedDetail: Record<string, unknown> | undefined
  if (detail !== undefined) {
    const detailResult = parseExperienceDetail(experience.kind, detail)
    if (!detailResult.ok) return err(detailResult.error)
    patchedDetail = detailResult.value
  }

  // A field left out of the patch keeps its current value; the aggregate reads
  // undefined as "unchanged", which is why detail stays undefined when absent.
  const patch: FactPatch = {
    title,
    organization,
    startDate,
    endDate,
    isCurrent,
    detail: patchedDetail,
  }
  const updated = updateFact(experience, patch, deps.clock.now())
  await deps.experienceRepo.save(updated)
  return ok(updated)
}
