/**
 * @file revisionChain
 * @description Shared navigation of a resume's live revision chain, used by undo,
 * redo and the freeze guard. Undo and redo only move the cursor; neither creates
 * a revision.
 *
 * Constraints:
 * - Superseded rows are filtered before a neighbour is chosen: after a commit
 *   made while undone, the abandoned tail is superseded and a naive max(seq)
 *   scan would offer it as redoable history.
 */

import { isLiveRevision } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { ResumeId, RevisionId } from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'

/** The unsuperseded chain, ascending by sequence. */
export async function liveRevisionChain(
  resumes: ResumeRepository,
  resumeId: ResumeId,
): Promise<readonly Revision[]> {
  const revisions = await resumes.listRevisions(resumeId)
  return revisions
    .filter((revision) => isLiveRevision(revision))
    .sort((left, right) => left.seq - right.seq)
}

/** The position of the cursor on the live chain, or -1 when it is not on it. */
export function cursorPosition(chain: readonly Revision[], cursor: RevisionId): number {
  return chain.findIndex((revision) => revision.id === cursor)
}

export function cursorNotOnLiveChain(resumeId: ResumeId, blockers: readonly string[]): DomainError {
  return new DomainError(
    'cursorNotOnLiveChain',
    'The cursor is not on the live revision chain.',
    { entity: 'resume', id: resumeId, blockers },
  )
}
