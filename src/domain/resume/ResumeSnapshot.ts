/**
 * @file ResumeSnapshot
 * @description The frozen form of a resume: the document state it was frozen at
 * plus the materialized blocks an export renders. Every library reference is
 * resolved into text at freeze time, so a snapshot never changes afterwards and
 * survives deletion of the entries it was built from.
 *
 * Responsibilities:
 * - Declare the frozen payload and the materialized document it stores
 * - Number snapshots per resume
 *
 * Constraints:
 * - The snapshot stores materialized blocks, not their geometry: layout is a
 *   pure function of blocks, so an export recomputes the same pages and a
 *   improvement to the layout engine improves existing snapshots.
 * - Cross-context types (`LayoutBlock`, `MissingReference`) stay domain types.
 */

import type { DateTime } from '../shared/DateTime'
import type { ResumeId, SnapshotId } from '../shared/branded-id'
import type { LayoutBlock } from './Layout'
import type { MissingReference } from './MissingReference'
import type { ResumeDocumentState } from './DocumentState'

/** What the materializer reports next to the blocks it produced. */
export type MaterializedWarning = 'entry-missing' | 'image-missing' | 'text-truncated'

/** The content a resume renders, independent of geometry. */
export interface MaterializedDocument {
  readonly blocks: readonly LayoutBlock[]
  readonly missingReferences: readonly MissingReference[]
  readonly warnings: readonly MaterializedWarning[]
}

export interface ResumeSnapshot {
  readonly id: SnapshotId
  readonly resumeId: ResumeId
  readonly seq: number
  /** The document state the snapshot was taken from; supports duplication. */
  readonly frozenState: ResumeDocumentState
  /** The materialized blocks an export lays out. */
  readonly materialized: MaterializedDocument
  readonly createdAt: DateTime
}

/** New snapshots continue the sequence; a resume numbers them from 1. */
export function nextSnapshotSeq(existing: readonly ResumeSnapshot[]): number {
  let highest = 0
  for (const snapshot of existing) {
    if (snapshot.seq > highest) highest = snapshot.seq
  }
  return highest + 1
}
