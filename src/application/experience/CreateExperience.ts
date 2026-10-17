/**
 * @file CreateExperience
 * @description Creates one experience row. The catalog screen and the agent
 * tools share this entry point, so raw input is validated here before the
 * aggregate sees it.
 *
 * Responsibilities:
 * - Validate the command shape and the kind-specific detail record
 * - Allocate the identifier and persist the new aggregate
 *
 * Constraints:
 * - Argument-shape problems return an Err. Invariant violations (blank title,
 *   current with an end date, end before start) come back as a DomainError
 *   thrown by the aggregate and are deliberately not caught here.
 * - Time and identifiers arrive through injected ports, never from ambient
 *   globals, so a write's timestamp and id are predictable in tests.
 */

import { z } from 'zod'
import { createExperience as createExperienceAggregate } from '../../domain/catalog/Experience'
import type { Experience } from '../../domain/catalog/Experience'
import { EXPERIENCE_KINDS } from '../../domain/catalog/ExperienceKind'
import type { ExperienceKind } from '../../domain/catalog/ExperienceKind'
import type { Clock } from '../../domain/shared/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import { parseIsoDate } from '../../domain/shared/DateTime'
import { asExperienceId } from '../../domain/shared/branded-id'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import { err, ok } from '../../domain/shared/Result'
import type { Result } from '../../domain/shared/Result'
import type { ExperienceDetailError } from '../catalog/experienceDetailSchemas'
import { parseExperienceDetail } from '../catalog/experienceDetailSchemas'

/**
 * Delegates calendar validity to parseIsoDate, so the rule lives in one place;
 * a plain YYYY-MM-DD pattern would accept 2026-02-31.
 */
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

const createExperienceCommandSchema = z.object({
  kind: z.enum(EXPERIENCE_KINDS),
  /** Unconstrained on purpose: the aggregate owns the blank-title invariant. */
  title: z.string().trim(),
  organization: z.string().trim().min(1).nullable().optional(),
  startDate: isoDateInput.nullable().optional(),
  endDate: isoDateInput.nullable().optional(),
  isCurrent: z.boolean().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
})

export interface CreateExperienceDeps {
  readonly experienceRepo: ExperienceRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface CreateExperienceCommand {
  readonly kind: ExperienceKind
  readonly title: string
  readonly organization?: string | null
  /** YYYY-MM-DD; null clears the field. */
  readonly startDate?: string | null
  readonly endDate?: string | null
  readonly isCurrent?: boolean
  /**
   * Checked against the schema this kind selects. Omitted means the row starts
   * without detail, which is a legal half-filled state the editor completes
   * through UpdateExperienceFact.
   */
  readonly detail?: Readonly<Record<string, unknown>>
}

export async function createExperience(
  deps: CreateExperienceDeps,
  command: CreateExperienceCommand,
): Promise<Result<Experience, ExperienceDetailError>> {
  const parsed = createExperienceCommandSchema.safeParse(command)
  if (!parsed.success) return err(parsed.error)
  const { kind, title, organization, startDate, endDate, isCurrent } = parsed.data

  let detail: Record<string, unknown> = {}
  if (parsed.data.detail !== undefined) {
    const detailResult = parseExperienceDetail(kind, parsed.data.detail)
    if (!detailResult.ok) return err(detailResult.error)
    detail = detailResult.value
  }

  const experience = createExperienceAggregate(
    {
      id: asExperienceId(deps.ids.next()),
      kind,
      title,
      organization,
      startDate,
      endDate,
      isCurrent,
      detail,
    },
    deps.clock.now(),
  )
  await deps.experienceRepo.save(experience)
  return ok(experience)
}
