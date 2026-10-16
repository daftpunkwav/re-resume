/**
 * @file Experience
 * @description Aggregate root for a single experience, together with its
 * variants and claims. Every business rule about this data lives here; the
 * application layer only sequences calls and persists the result.
 *
 * Responsibilities:
 * - Enforce the fact/date/label/statement invariants
 * - Own factVersion, the scalar that tells a resume block whether the facts
 *   it copied have moved on
 *
 * Constraints:
 * - This module must not depend on any third-party package.
 * - Confirmation never bumps factVersion: a confirmation is not a fact change,
 *   and bumping it would mark every block referencing this experience stale.
 */

import { DomainError } from '../shared/DomainError'
import type { DateTime, IsoDate } from '../shared/DateTime'
import type { ClaimId, ExperienceId, VariantId } from '../shared/branded-id'
import type { Claim } from './Claim'
import type { ClaimInput } from './Claim'
import type { ClaimStatus } from './ClaimStatus'
import { canTransition } from './ClaimStatus'
import type { ExperienceKind } from './ExperienceKind'
import type { Variant, VariantInput, VariantPatch } from './Variant'

export interface Experience {
  readonly id: ExperienceId
  readonly kind: ExperienceKind
  readonly title: string
  readonly organization: string | null
  readonly startDate: IsoDate | null
  readonly endDate: IsoDate | null
  readonly isCurrent: boolean
  /** Type-specific fields; shape is validated per kind by the application layer. */
  readonly detail: Readonly<Record<string, unknown>>
  readonly variants: readonly Variant[]
  readonly claims: readonly Claim[]
  /** Bumped only by fact-field or variant changes; see invariant 6. */
  readonly factVersion: number
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

export interface CreateExperienceInput {
  readonly id: ExperienceId
  readonly kind: ExperienceKind
  readonly title: string
  readonly organization?: string | null
  readonly startDate?: IsoDate | null
  readonly endDate?: IsoDate | null
  readonly isCurrent?: boolean
  readonly detail?: Readonly<Record<string, unknown>>
}

export interface FactPatch {
  readonly title?: string
  readonly organization?: string | null
  readonly startDate?: IsoDate | null
  readonly endDate?: IsoDate | null
  readonly isCurrent?: boolean
  readonly detail?: Readonly<Record<string, unknown>>
}

function assertTitle(title: string, id: ExperienceId): void {
  if (title.trim().length === 0) {
    throw new DomainError('emptyTitle', 'Experience title must not be blank.', {
      entity: 'experience',
      id,
      blockers: [],
    })
  }
}

function assertDates(
  id: ExperienceId,
  startDate: IsoDate | null,
  endDate: IsoDate | null,
  isCurrent: boolean,
): void {
  if (isCurrent && endDate !== null) {
    throw new DomainError(
      'currentWithEndDate',
      'An experience marked as current must not carry an end date.',
      { entity: 'experience', id, blockers: [] },
    )
  }
  if (startDate !== null && endDate !== null && endDate < startDate) {
    throw new DomainError('endBeforeStart', 'End date must not precede start date.', {
      entity: 'experience',
      id,
      blockers: [],
    })
  }
}

function assertUniqueVariantLabels(id: ExperienceId, variants: readonly Variant[]): void {
  const seen = new Set<string>()
  for (const variant of variants) {
    if (seen.has(variant.label)) {
      throw new DomainError(
        'duplicateVariantLabel',
        `Variant label "${variant.label}" is already used by this experience.`,
        { entity: 'experience', id, blockers: [] },
      )
    }
    seen.add(variant.label)
  }
}

/**
 * Rejected claims do not hold the statement key, which is what lets a user
 * reject a wording and later add the same wording as a new claim.
 */
function assertUniqueActiveStatements(id: ExperienceId, claims: readonly Claim[]): void {
  const seen = new Set<string>()
  for (const claim of claims) {
    if (claim.status === 'rejected') continue
    if (seen.has(claim.statement)) {
      throw new DomainError(
        'duplicateClaimStatement',
        `Claim statement "${claim.statement}" is already active on this experience.`,
        { entity: 'experience', id, blockers: [] },
      )
    }
    seen.add(claim.statement)
  }
}

export function createExperience(
  input: CreateExperienceInput,
  now: DateTime,
): Experience {
  const isCurrent = input.isCurrent ?? false
  const endDate = input.endDate ?? null
  assertTitle(input.title, input.id)
  assertDates(input.id, input.startDate ?? null, endDate, isCurrent)
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    organization: input.organization ?? null,
    startDate: input.startDate ?? null,
    endDate,
    isCurrent,
    detail: input.detail ?? {},
    variants: [],
    claims: [],
    factVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateFact(
  experience: Experience,
  patch: FactPatch,
  now: DateTime,
): Experience {
  const title = patch.title ?? experience.title
  const isCurrent = patch.isCurrent ?? experience.isCurrent
  const startDate = patch.startDate === undefined ? experience.startDate : patch.startDate
  const endDate = patch.endDate === undefined ? experience.endDate : patch.endDate
  assertTitle(title, experience.id)
  assertDates(experience.id, startDate, endDate, isCurrent)
  return {
    ...experience,
    title,
    organization:
      patch.organization === undefined ? experience.organization : patch.organization,
    startDate,
    endDate,
    isCurrent,
    detail: patch.detail ?? experience.detail,
    factVersion: experience.factVersion + 1,
    updatedAt: now,
  }
}

export function addVariant(
  experience: Experience,
  input: VariantInput,
  now: DateTime,
): Experience {
  const variants: Variant[] = [
    ...experience.variants,
    {
      ...input,
      experienceId: experience.id,
      createdAt: now,
      updatedAt: now,
    },
  ]
  assertUniqueVariantLabels(experience.id, variants)
  return {
    ...experience,
    variants,
    factVersion: experience.factVersion + 1,
    updatedAt: now,
  }
}

export function updateVariant(
  experience: Experience,
  variantId: VariantId,
  patch: VariantPatch,
  now: DateTime,
): Experience {
  const existing = findVariant(experience, variantId)
  const updated: Variant = {
    ...existing,
    label: patch.label ?? existing.label,
    content: patch.content ?? existing.content,
    emphasis: patch.emphasis === undefined ? existing.emphasis : patch.emphasis,
    updatedAt: now,
  }
  const variants = replaceVariant(experience.variants, updated)
  assertUniqueVariantLabels(experience.id, variants)
  return {
    ...experience,
    variants,
    factVersion: experience.factVersion + 1,
    updatedAt: now,
  }
}

export function removeVariant(
  experience: Experience,
  variantId: VariantId,
  now: DateTime,
): Experience {
  findVariant(experience, variantId)
  return {
    ...experience,
    variants: experience.variants.filter((variant) => variant.id !== variantId),
    factVersion: experience.factVersion + 1,
    updatedAt: now,
  }
}

/** Writes only confirmedAt. factVersion stays put — see the file header. */
export function confirmVariantDraft(
  experience: Experience,
  variantId: VariantId,
  now: DateTime,
): Experience {
  const existing = findVariant(experience, variantId)
  const updated: Variant = { ...existing, confirmedAt: now, updatedAt: now }
  return {
    ...experience,
    variants: replaceVariant(experience.variants, updated),
    updatedAt: now,
  }
}

export function addClaim(
  experience: Experience,
  input: ClaimInput,
  now: DateTime,
): Experience {
  const claims: Claim[] = [
    ...experience.claims,
    {
      ...input,
      experienceId: experience.id,
      createdAt: now,
      updatedAt: now,
    },
  ]
  assertUniqueActiveStatements(experience.id, claims)
  return { ...experience, claims, updatedAt: now }
}

export function confirmClaim(
  experience: Experience,
  claimId: ClaimId,
  now: DateTime,
): Experience {
  return transitionClaim(experience, claimId, 'confirmed', now)
}

export function rejectClaim(
  experience: Experience,
  claimId: ClaimId,
  now: DateTime,
): Experience {
  return transitionClaim(experience, claimId, 'rejected', now)
}

export function reopenClaim(
  experience: Experience,
  claimId: ClaimId,
  now: DateTime,
): Experience {
  return transitionClaim(experience, claimId, 'pending', now)
}

function transitionClaim(
  experience: Experience,
  claimId: ClaimId,
  to: ClaimStatus,
  now: DateTime,
): Experience {
  const existing = findClaim(experience, claimId)
  if (!canTransition(existing.status, to)) {
    throw new DomainError(
      'invalidClaimTransition',
      `Claim cannot move from ${existing.status} to ${to}.`,
      { entity: 'experience', id: experience.id, blockers: [claimId] },
    )
  }
  const updated: Claim = { ...existing, status: to, updatedAt: now }
  const claims = replaceClaim(experience.claims, updated)
  assertUniqueActiveStatements(experience.id, claims)
  return { ...experience, claims, updatedAt: now }
}

function findVariant(experience: Experience, variantId: VariantId): Variant {
  const found = experience.variants.find((variant) => variant.id === variantId)
  if (found === undefined) {
    throw new DomainError('variantNotInExperience', 'Variant does not belong to this experience.', {
      entity: 'experience',
      id: experience.id,
      blockers: [variantId],
    })
  }
  return found
}

function findClaim(experience: Experience, claimId: ClaimId): Claim {
  const found = experience.claims.find((claim) => claim.id === claimId)
  if (found === undefined) {
    throw new DomainError('claimNotFound', 'Claim does not belong to this experience.', {
      entity: 'experience',
      id: experience.id,
      blockers: [claimId],
    })
  }
  return found
}

function replaceVariant(
  variants: readonly Variant[],
  updated: Variant,
): readonly Variant[] {
  return variants.map((variant) => (variant.id === updated.id ? updated : variant))
}

function replaceClaim(claims: readonly Claim[], updated: Claim): readonly Claim[] {
  return claims.map((claim) => (claim.id === updated.id ? updated : claim))
}

export function describeExperience(experience: Experience): string {
  const org = experience.organization === null ? '' : ` @ ${experience.organization}`
  return `${experience.title}${org}`
}
