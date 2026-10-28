/**
 * @file cancelRun
 * @description Stops the run streaming in a conversation. The run loop keeps
 * whatever text it had produced and moves the run to `cancelled`.
 *
 * Constraints:
 * - Idempotent: stopping a conversation with no run in flight is a no-op, not
 *   an error, because a user can press stop twice or after the run finished.
 */

import type { ConversationId } from '../../domain/shared/branded-id'
import type { ActiveRunRegistry } from './activeRunRegistry'

export interface CancelRunDeps {
  readonly activeRuns: ActiveRunRegistry
}

export interface CancelRunInput {
  readonly conversationId: ConversationId
}

/** Returns true when a run was actually aborted. */
export async function cancelRun(
  deps: CancelRunDeps,
  input: CancelRunInput,
): Promise<boolean> {
  return deps.activeRuns.cancel(input.conversationId)
}
