/**
 * @file ResumeRepository
 * @description Persistence port for the resume aggregate: the pointer row, the
 * revision chain that doubles as its history, the frozen snapshots, and the
 * metadata columns that deliberately stay out of the chain.
 *
 * Constraints:
 * - Only domain types: no application type and no database row may appear here.
 * - Every composite write is one transaction. Partial application of the
 *   revision chain (supersede, append, cursor, trim) is a contract violation.
 * - `saveDocument` and `appendSnapshot` carry `expectedRevisionId`, the revision
 *   the caller read the state from; a mismatch is `revisionMismatch`.
 */

import type { ConversationId, ResumeId, RevisionId, SnapshotId } from '../../shared/branded-id'
import type { DateTime } from '../../shared/DateTime'
import type { ResumeDocumentState, DocumentChangeMeta } from '../DocumentState'
import type { Resume } from '../Resume'
import type { ResumeSnapshot } from '../ResumeSnapshot'
import type { Revision } from '../Revision'
import type { TargetJob } from '../TargetJob'

/** The metadata columns that are written directly, never through a revision. */
export interface ResumeMetadataPatch {
  readonly title?: string
  readonly targetJob?: TargetJob | null
  readonly conversationId?: ConversationId | null
}

export interface ResumeRepository {
  /** Hydrates the aggregate: pointer row + the revision the cursor names. */
  findById(id: ResumeId): Promise<Resume | null>
  listAll(): Promise<readonly Resume[]>
  /** resume row + its first revision, in one transaction. */
  insertWithInitialRevision(resume: Resume, revision: Revision): Promise<void>
  /**
   * Supersede the abandoned branch, append the revision, move the cursor and
   * trim the live chain, in one transaction.
   *
   * @throws DomainError `revisionMismatch` when the stored cursor is not
   *   `expectedRevisionId`.
   */
  saveDocument(
    id: ResumeId,
    state: ResumeDocumentState,
    change: DocumentChangeMeta,
    expectedRevisionId: RevisionId,
  ): Promise<Revision>
  /** Undo/redo: moves the cursor without creating a revision. */
  moveCursor(id: ResumeId, revisionId: RevisionId): Promise<void>
  /** The whole chain, ascending by seq, superseded rows included. */
  listRevisions(id: ResumeId): Promise<readonly Revision[]>
  readRevision(id: RevisionId): Promise<Revision | null>
  findSnapshotById(id: SnapshotId): Promise<ResumeSnapshot | null>
  /** The snapshot that justifies a frozen status, plus the status, in one transaction. */
  appendSnapshot(snapshot: ResumeSnapshot, expectedRevisionId: RevisionId): Promise<void>
  /** Metadata direct write: title, target job and associated conversation. */
  updateMetadata(id: ResumeId, patch: ResumeMetadataPatch, now: DateTime): Promise<void>
  /** Deletes the resume; revisions and snapshots cascade, cross-domain pointers are cleared. */
  delete(id: ResumeId): Promise<void>
}
