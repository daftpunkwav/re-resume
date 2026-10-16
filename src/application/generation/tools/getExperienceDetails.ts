/**
 * @file getExperienceDetails
 * @description Reads one experience in full: its facts, its variants and the
 * claims behind them. The confirmation state travels with each variant because
 * an unconfirmed draft cannot be referenced by a resume, and a model that
 * cannot see that will keep proposing it.
 *
 * Constraints:
 * - read level. A missing row is a reported outcome, not an exception: the run
 *   loop feeds the outcome back to the model instead of failing the run.
 */

import { z } from 'zod'
import type { Experience } from '../../../domain/catalog/Experience'
import type { ClaimKind } from '../../../domain/catalog/ClaimKind'
import type { ClaimStatus } from '../../../domain/catalog/ClaimStatus'
import type { ExperienceKind } from '../../../domain/catalog/ExperienceKind'
import type { ClaimId, ExperienceId, VariantId } from '../../../domain/shared/branded-id'
import { asExperienceId } from '../../../domain/shared/branded-id'
import type { DateTime, IsoDate } from '../../../domain/shared/DateTime'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

export const getExperienceDetailsInputSchema = z.object({
  experienceId: z.string().trim().min(1),
}).strict()

export interface GetExperienceDetailsInput {
  readonly experienceId: string
}

export interface VariantDetail {
  readonly variantId: VariantId
  readonly label: string
  readonly content: string
  readonly emphasis: string | null
  /** False while the variant is an agent draft awaiting the user's review. */
  readonly confirmed: boolean
  readonly draftedByRunId: string | null
  readonly updatedAt: DateTime
}

export interface ClaimDetail {
  readonly claimId: ClaimId
  readonly kind: ClaimKind
  readonly statement: string
  readonly sourceField: string | null
  readonly status: ClaimStatus
}

export interface ExperienceDetail {
  readonly experienceId: ExperienceId
  readonly kind: ExperienceKind
  readonly title: string
  readonly organization: string | null
  readonly startDate: IsoDate | null
  readonly endDate: IsoDate | null
  readonly isCurrent: boolean
  readonly factVersion: number
  readonly detail: Readonly<Record<string, unknown>>
  readonly variants: readonly VariantDetail[]
  readonly claims: readonly ClaimDetail[]
}

export type ExperienceDetailsResult =
  | { readonly kind: 'found'; readonly experience: ExperienceDetail }
  | { readonly kind: 'notFound'; readonly experienceId: string }

export const getExperienceDetails: RegisteredTool<
  GetExperienceDetailsInput,
  ExperienceDetailsResult
> = {
  name: 'getExperienceDetails',
  description:
    'Read one experience: its facts, its variants with confirmation state, and its claims.',
  risk: 'read',
  parse: (raw: unknown): Result<GetExperienceDetailsInput> => {
    const parsed = getExperienceDetailsInputSchema.safeParse(raw)
    return parsed.success ? ok(parsed.data) : err(parsed.error)
  },
  execute: async (
    input: GetExperienceDetailsInput,
    ctx: ToolContext,
  ): Promise<ExperienceDetailsResult> => {
    const experience = await ctx.experiences.findById(asExperienceId(input.experienceId))
    if (experience === null) {
      return { kind: 'notFound', experienceId: input.experienceId }
    }
    return { kind: 'found', experience: toDetail(experience) }
  },
}

function toDetail(experience: Experience): ExperienceDetail {
  return {
    experienceId: experience.id,
    kind: experience.kind,
    title: experience.title,
    organization: experience.organization,
    startDate: experience.startDate,
    endDate: experience.endDate,
    isCurrent: experience.isCurrent,
    factVersion: experience.factVersion,
    detail: experience.detail,
    variants: experience.variants.map((variant) => ({
      variantId: variant.id,
      label: variant.label,
      content: variant.content,
      emphasis: variant.emphasis,
      confirmed: variant.confirmedAt !== null,
      draftedByRunId: variant.draftedByRunId,
      updatedAt: variant.updatedAt,
    })),
    claims: experience.claims.map((claim) => ({
      claimId: claim.id,
      kind: claim.kind,
      statement: claim.statement,
      sourceField: claim.sourceField,
      status: claim.status,
    })),
  }
}
