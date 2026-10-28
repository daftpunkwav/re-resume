/**
 * @file workspaceEvents
 * @description The one-way signal bus between a running assistant turn and the
 * workspace panels.
 *
 * Responsibilities:
 * - Publish every AgentEvent the conversation store reduces, plus the undo
 *   transitions the panels have to follow
 * - Let the workspace integration subscribe without the conversation store
 *   importing the information or resume feature
 *
 * Constraints:
 * - Delivery is synchronous and best effort: a panel that is not mounted has
 *   nothing to refresh, and the next reveal request brings it up to date.
 * - No queue is kept here. The integration runs one handler at a time and the
 *   panel stores hold their own pending reveal request, which is what survives a
 *   panel that mounts a moment later.
 */

import type { AgentEvent } from '../../../domain/generation/AgentEvent'

export type UndoScope = 'library' | 'resume'

export type WorkspaceSignal =
  | { readonly kind: 'agentEvent'; readonly event: AgentEvent }
  | { readonly kind: 'changesUndone'; readonly scope: UndoScope }

export type WorkspaceSignalListener = (signal: WorkspaceSignal) => void

const listeners = new Set<WorkspaceSignalListener>()

/** Registers one listener and returns the removal. */
export function subscribeWorkspaceSignals(listener: WorkspaceSignalListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Delivers a signal to every listener; a listener that throws cannot stop the rest. */
export function publishWorkspaceSignal(signal: WorkspaceSignal): void {
  for (const listener of [...listeners]) {
    try {
      listener(signal)
    } catch {
      // A panel that failed to follow one signal must not break the run or the
      // other listeners. Its own store reports the failure through its state.
    }
  }
}

/** Test hook: drops every listener of this module instance. */
export function resetWorkspaceSignals(): void {
  listeners.clear()
}
