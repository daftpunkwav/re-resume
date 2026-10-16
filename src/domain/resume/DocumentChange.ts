/**
 * @file DocumentChange
 * @description The command shape behind every document mutation. A change is a
 * pure function from one DocumentState to the next, which is what makes undo,
 * redo and agent preview the same mechanism.
 *
 * Constraints:
 * - next must stay pure. It captures no repository, clock or id source.
 */

import type { AgentRunId } from '../shared/branded-id'
import type { Block } from './Block'
import type { PageSetup } from './PageSetup'

export type ChangeOrigin = 'user' | 'agent'

/** Metadata persisted with each revision; DocumentChange adds the pure transition. */
export interface DocumentChangeMeta {
  readonly label: string
  readonly origin: ChangeOrigin
  readonly runId: AgentRunId | null
}

/** Full editable document state; a revision snapshots exactly this. */
export interface DocumentState {
  readonly blocks: readonly Block[]
  readonly pageSetup: PageSetup
}

export interface DocumentChange extends DocumentChangeMeta {
  /** Produces the next document state. Must be pure. */
  readonly next: (state: DocumentState) => DocumentState
}

/** A change that only records metadata; useful for labels that describe a run. */
export function describeChange(
  meta: DocumentChangeMeta,
  next: (state: DocumentState) => DocumentState,
): DocumentChange {
  return { ...meta, next }
}

export function identityChange(state: DocumentState): DocumentState {
  return state
}
