/**
 * @file DetectStaleReferences
 * @description Lists the resumes whose experience blocks have fallen behind the
 * experience library. Recomputed on demand rather than stored: persistence
 * would create a second source of truth for a derived fact.
 *
 * Constraints:
 * - Profile blocks are excluded. A profile block is a copy with its own sync
 *   prompt, and this query is keyed by experienceId.
 * - A pending claim is not stale. It may legally sit in a draft; the freeze
 *   and export gates handle it.
 */

import { isExperienceContent } from '../../domain/resume/Block'
import type { Resume } from '../../domain/resume/Resume'
import type { Claim } from '../../domain/catalog/Claim'
import type { BlockId, ClaimId, ExperienceId, ResumeId } from '../../domain/shared/branded-id'

export type StaleReason =
  | { readonly kind: 'factChanged'; readonly knownFactVersion: number }
  | { readonly kind: 'claimRejected'; readonly claimId: ClaimId }

export interface StaleReference {
  readonly resumeId: ResumeId
  readonly blockId: BlockId
  readonly reasons: readonly StaleReason[]
}

export function detectStaleReferences(
  resumes: readonly Resume[],
  experienceId: ExperienceId,
  knownFactVersion: number,
  currentClaims: readonly Claim[],
): readonly StaleReference[] {
  const rejected = rejectedClaimIds(currentClaims)
  const stale: StaleReference[] = []
  for (const resume of resumes) {
    for (const block of resume.blocks) {
      if (!isExperienceContent(block.content)) continue
      if (block.content.experienceId !== experienceId) continue
      const reasons: StaleReason[] = []
      if (block.content.refVersion !== knownFactVersion) {
        reasons.push({ kind: 'factChanged', knownFactVersion })
      }
      for (const claimId of block.content.claimIds) {
        if (rejected.has(claimId)) reasons.push({ kind: 'claimRejected', claimId })
      }
      if (reasons.length === 0) continue
      stale.push({ resumeId: resume.id, blockId: block.id, reasons })
    }
  }
  return stale
}

function rejectedClaimIds(claims: readonly Claim[]): ReadonlySet<ClaimId> {
  const rejected = new Set<ClaimId>()
  for (const claim of claims) {
    if (claim.status === 'rejected') rejected.add(claim.id)
  }
  return rejected
}
