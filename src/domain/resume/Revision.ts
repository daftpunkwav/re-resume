/**
 * @file Revision
 * @description One entry of a resume's undo/redo chain, doubling as its change
 * record. Revisions store whole document states rather than patches: a resume
 * is a few pages, and whole-state storage buys undo, redo, agent preview and
 * an audit trail without an event-sourcing layer.
 */

import type { DateTime } from '../shared/DateTime'
import type { AgentRunId, ResumeId, RevisionId } from '../shared/branded-id'
import type { ChangeOrigin, DocumentState } from './DocumentChange'

export interface Revision {
  readonly id: RevisionId
  readonly resumeId: ResumeId
  /** Monotonic per resume, never reused; UNIQUE (resume_id, seq). */
  readonly seq: number
  readonly label: string
  readonly origin: ChangeOrigin
  readonly runId: AgentRunId | null
  /** The full document state after this change. */
  readonly state: DocumentState
  /** Set when an undo branch was abandoned; see the cursor model. */
  readonly supersededAt: DateTime | null
  readonly createdAt: DateTime
}

export const INITIAL_REVISION_LABEL = '创建简历'

export function isLiveRevision(revision: Revision): boolean {
  return revision.supersededAt === null
}

/** New revisions continue the history, so seq is max(seq) + 1 and never reused. */
export function nextSeq(history: readonly Revision[]): number {
  let highest = 0
  for (const revision of history) {
    if (revision.seq > highest) highest = revision.seq
  }
  return highest + 1
}
