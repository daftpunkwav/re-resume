/**
 * @file ResumeSnapshot
 * @description The frozen form of a resume. Every reference is resolved to
 * inline text at freeze time, so a snapshot never changes afterwards and
 * survives deletion of the rows it was built from.
 */

import type { DateTime, IsoDate } from '../shared/DateTime'
import type { AssetId, BlockId, ClaimId, ResumeId, SnapshotId } from '../shared/branded-id'
import type { ProfileFields } from '../catalog/Profile'
import type { ClaimKind } from '../catalog/ClaimKind'
import type { BlockLayout } from './Layout'
import type { PageSetup } from './PageSetup'
import type { TextStyle } from './TextStyle'

export interface ResumeSnapshot {
  readonly id: SnapshotId
  readonly resumeId: ResumeId
  readonly seq: number
  /** Experience and variant content copied inline; no live references remain. */
  readonly materializedBlocks: readonly MaterializedBlock[]
  readonly pageSetup: PageSetup
  readonly createdAt: DateTime
}

/** Claim text inlined at freeze time; the claim row may later be deleted. */
export interface MaterializedClaim {
  readonly claimId: ClaimId
  readonly kind: ClaimKind
  readonly statement: string
  readonly sourceField: string | null
}

/** BlockContent with every reference resolved to inline text: the storage
 *  shape of materialized_json and the common input of both exporters. */
export type MaterializedContent =
  | { readonly type: 'text'; readonly text: string }
  | (ProfileFields & { readonly type: 'profile' })
  | {
      readonly type: 'experience'
      readonly title: string
      readonly organization: string | null
      readonly startDate: IsoDate | null
      readonly endDate: IsoDate | null
      readonly variantContent: string
    }
  | { readonly type: 'divider' }
  // The one deliberate live reference: image bytes are not inlined into
  // JSON. Assets referenced by any snapshot must not be deleted.
  | { readonly type: 'graphic'; readonly assetId: AssetId }

export interface MaterializedBlock {
  readonly id: BlockId
  /** Fact fields and the selected variant content, inlined as text. */
  readonly content: MaterializedContent
  readonly layout: BlockLayout
  /** Inlined with the block so the snapshot renders without any theme. */
  readonly textStyle: TextStyle | null
  /** Inline text, not a live reference: survives claim/experience deletion. */
  readonly claims: readonly MaterializedClaim[]
}

export function nextSnapshotSeq(existing: readonly ResumeSnapshot[]): number {
  let highest = 0
  for (const snapshot of existing) {
    if (snapshot.seq > highest) highest = snapshot.seq
  }
  return highest + 1
}
