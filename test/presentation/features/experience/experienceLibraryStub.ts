/**
 * @file experienceLibraryStub
 * @description Stands in for the composition root in catalog tests. Every
 * service member a test does not set throws when it is called, so an
 * unexpected round trip fails loudly instead of resolving to undefined and
 * leaving the assertion to chase a phantom.
 */

import { err } from '../../../../src/domain/shared/Result'
import type { Result } from '../../../../src/domain/shared/Result'
import type { ExperienceLibrary } from '../../../../src/bootstrap/compositionRoot'
import type { CompositionRoot } from '../../../../src/bootstrap/compositionRoot'
import { parseExperienceDetail } from '../../../../src/application/catalog/experienceDetailSchemas'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import type { Claim } from '../../../../src/domain/catalog/Claim'
import type { ClaimKind } from '../../../../src/domain/catalog/ClaimKind'
import type { ClaimStatus } from '../../../../src/domain/catalog/ClaimStatus'
import type { Experience } from '../../../../src/domain/catalog/Experience'
import type { ExperienceKind } from '../../../../src/domain/catalog/ExperienceKind'
import type { Variant } from '../../../../src/domain/catalog/Variant'
import { asAgentRunId, asClaimId, asExperienceId, asVariantId } from '../../../../src/domain/shared/branded-id'

const NOW: DateTime = parseDateTime('2026-03-01T09:00:00.000Z') as DateTime

type LibraryOverrides = Partial<ExperienceLibrary>

function unsetMember(name: string): never {
  throw new Error(`ExperienceLibrary.${name}() was called but this test did not set it.`)
}

export function createExperienceLibraryStub(overrides: LibraryOverrides = {}): ExperienceLibrary {
  return {
    list: overrides.list ?? (() => unsetMember('list')),
    get: overrides.get ?? (() => unsetMember('get')),
    create: overrides.create ?? (() => unsetMember('create')),
    updateFact: overrides.updateFact ?? (() => unsetMember('updateFact')),
    remove: overrides.remove ?? (() => unsetMember('remove')),
    addVariant: overrides.addVariant ?? (() => unsetMember('addVariant')),
    updateVariant: overrides.updateVariant ?? (() => unsetMember('updateVariant')),
    removeVariant: overrides.removeVariant ?? (() => unsetMember('removeVariant')),
    confirmVariant: overrides.confirmVariant ?? (() => unsetMember('confirmVariant')),
    addClaim: overrides.addClaim ?? (() => unsetMember('addClaim')),
    confirmClaim: overrides.confirmClaim ?? (() => unsetMember('confirmClaim')),
    rejectClaim: overrides.rejectClaim ?? (() => unsetMember('rejectClaim')),
    reopenClaim: overrides.reopenClaim ?? (() => unsetMember('reopenClaim')),
  }
}

/**
 * The catalog screen reads exactly one member of the root. Everything else is
 * left out on purpose: a test that needed it would be testing another feature.
 */
export function createCompositionRootStub(library: ExperienceLibrary): CatalogRoot {
  return { experiences: library }
}

export type CatalogRoot = Pick<CompositionRoot, 'experiences'>

/** A command that refused, shaped the way a use case returns one. */
export function refusedCommand<T>(reason: unknown): Promise<Result<T, unknown>> {
  return Promise.resolve(err(reason))
}

/**
 * The validation failure the real per-kind schemas raise for a record that does
 * not satisfy them, so a test exercises the same error a user would get.
 */
export function rejectedDetail(kind: ExperienceKind, raw: Record<string, unknown>): unknown {
  const parsed = parseExperienceDetail(kind, raw)
  if (parsed.ok) {
    throw new Error(`Expected the ${kind} detail record to be refused, but it parsed.`)
  }
  return parsed.error
}

export interface VariantOptions {
  readonly id: string
  readonly label: string
  readonly content: string
  readonly emphasis?: string | null
  readonly draftedByRunId?: string | null
  readonly confirmedAt?: DateTime | null
}

export function makeVariant(options: VariantOptions): Variant {
  return {
    id: asVariantId(options.id),
    experienceId: asExperienceId('exp-1'),
    label: options.label,
    content: options.content,
    emphasis: options.emphasis ?? null,
    draftedByRunId:
      options.draftedByRunId === undefined || options.draftedByRunId === null
        ? null
        : asAgentRunId(options.draftedByRunId),
    confirmedAt: options.confirmedAt === undefined ? NOW : options.confirmedAt,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export interface ClaimOptions {
  readonly id: string
  readonly kind: ClaimKind
  readonly statement: string
  readonly sourceField?: string | null
  readonly status?: ClaimStatus
}

export function makeClaim(options: ClaimOptions): Claim {
  return {
    id: asClaimId(options.id),
    experienceId: asExperienceId('exp-1'),
    kind: options.kind,
    statement: options.statement,
    sourceField: options.sourceField ?? null,
    status: options.status ?? 'pending',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export interface ExperienceOptions {
  readonly id: string
  readonly kind: ExperienceKind
  readonly title: string
  readonly organization?: string | null
  readonly detail?: Record<string, unknown>
  readonly variants?: readonly Variant[]
  readonly claims?: readonly Claim[]
  readonly factVersion?: number
}

export function makeExperience(options: ExperienceOptions): Experience {
  return {
    id: asExperienceId(options.id),
    kind: options.kind,
    title: options.title,
    organization: options.organization === undefined ? null : options.organization,
    startDate: null,
    endDate: null,
    isCurrent: false,
    detail: options.detail ?? {},
    variants: options.variants ?? [],
    claims: options.claims ?? [],
    factVersion: options.factVersion ?? 1,
    createdAt: NOW,
    updatedAt: NOW,
  }
}
