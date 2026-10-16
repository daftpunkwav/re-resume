/**
 * @file Claim
 * @description A single checkable assertion about one experience. Claims are
 * what make "AI does not fabricate facts" a structural property: a number in a
 * resume has to point at a row here.
 */

import type { DateTime } from '../shared/DateTime'
import type { ClaimId, ExperienceId } from '../shared/branded-id'
import type { ClaimKind } from './ClaimKind'
import type { ClaimStatus } from './ClaimStatus'

export interface Claim {
  readonly id: ClaimId
  readonly experienceId: ExperienceId
  readonly kind: ClaimKind
  readonly statement: string
  /** Which fact field this assertion derives from, e.g. "detail.coverage". */
  readonly sourceField: string | null
  readonly status: ClaimStatus
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

export interface ClaimInput {
  readonly id: ClaimId
  readonly kind: ClaimKind
  readonly statement: string
  readonly sourceField: string | null
  readonly status: ClaimStatus
}
