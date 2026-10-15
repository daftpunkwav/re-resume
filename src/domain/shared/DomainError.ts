/**
 * @file DomainError
 * @description The single error type thrown when an aggregate invariant would
 * be violated. Every rejection carries a stable code plus context so the UI can
 * explain what was refused without parsing messages.
 *
 * Responsibilities:
 * - Categorise invariant violations with a closed code set
 * - Attach the offending identifiers so callers can list what blocked them
 *
 * Constraints:
 * - This module must not depend on UI-layer components.
 * - Codes are part of the application contract; renaming one is a breaking change.
 */

export const DOMAIN_ERROR_CODES = [
  'emptyTitle',
  'currentWithEndDate',
  'endBeforeStart',
  'duplicateVariantLabel',
  'duplicateClaimStatement',
  'duplicateBlockId',
  'multipleProfileBlocks',
  'emptyResume',
  'frozenWithoutSnapshot',
  'frozenResumeImmutable',
  'cursorNotOnLiveChain',
  'variantNotInExperience',
  'variantUnconfirmed',
  'claimRejected',
  'claimPending',
  'referencedByBlocks',
  'invalidClaimTransition',
] as const

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]

export interface DomainErrorDetail {
  readonly entity: string
  readonly id: string
  /** Referencing resumes and blocks; populated by reference checks. */
  readonly blockers: readonly string[]
}

export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly detail: DomainErrorDetail | null

  constructor(code: DomainErrorCode, message: string, detail: DomainErrorDetail | null = null) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.detail = detail
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError
}
