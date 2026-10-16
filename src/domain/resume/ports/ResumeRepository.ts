/**
 * @file ResumeRepository
 * @description Persistence port for the resume aggregate, including the
 * revision chain that doubles as its undo/redo history and change record.
 *
 * Constraints:
 * - DocumentChangeMeta comes from domain/resume/DocumentChange: no
 *   application-layer type may appear in a domain port.
 */

import type { Resume } from '../Resume'
import type { Revision } from '../Revision'
import type { ResumeSnapshot } from '../ResumeSnapshot'
import type { DocumentChangeMeta, DocumentState } from '../DocumentChange'
import type { ResumeId, RevisionId, SnapshotId } from '../../shared/branded-id'

export interface ResumeRepository {
  /** Hydrates the aggregate from resume + its current revision (blocks, pageSetup). */
  findById(id: ResumeId): Promise<Resume | null>
  listAll(): Promise<readonly Resume[]>
  /**
   * Appends a revision (full DocumentState), advances the cursor, supersedes
   * the abandoned branch and applies the trim rule — atomically. Partial
   * application of any of these steps is a contract violation.
   */
  saveDocument(
    id: ResumeId,
    state: DocumentState,
    change: DocumentChangeMeta,
  ): Promise<Revision>
  /** Undo/redo: moves the cursor without creating a revision. Refused for frozen resumes. */
  moveCursor(id: ResumeId, revisionId: RevisionId): Promise<void>
  readRevision(id: RevisionId): Promise<Revision | null>
  /**
   * Reads one snapshot by its own identifier; null when no snapshot carries it.
   * A snapshot is addressed without its resume, so it is the port rather than
   * findById that has to make that lookup — reading every resume to find one
   * snapshot is what a comparison must not do.
   */
  findSnapshotById(id: SnapshotId): Promise<ResumeSnapshot | null>
  appendSnapshot(snapshot: ResumeSnapshot): Promise<void>
}
