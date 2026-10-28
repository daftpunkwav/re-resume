/**
 * @file activeRunRegistry
 * @description Tracks the run currently streaming per conversation, so the
 * interface can stop it. It holds one AbortController per conversation for the
 * lifetime of one composition root.
 *
 * Responsibilities:
 * - Hand a run the signal that `cancelRun` will abort
 * - Release the slot when the run settles, however it settled
 * - Make a stop request idempotent: stopping a conversation with no run in
 *   flight returns false and does nothing
 *
 * Constraints:
 * - This is per-root state, not a global. The composition root constructs one
 *   instance and hands it to the run service; a second root (a settings rebuild)
 *   has its own, and the database gate is what protects the conversation across
 *   roots.
 * - A second `run` for a conversation that is already streaming receives the
 *   same signal and does not own the slot: the run loop's database gate returns
 *   the existing run, and the first run's settlement releases the slot.
 */

import type { ConversationId } from '../../domain/shared/branded-id'

export interface ActiveRunHandle {
  readonly signal: AbortSignal
  /** Releases the slot when this call owns it. */
  finish(): void
}

export class ActiveRunRegistry {
  readonly #controllers = new Map<ConversationId, AbortController>()

  /** Runs `work` with the signal of this conversation, releasing it afterwards. */
  async run<T>(conversationId: ConversationId, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const existing = this.#controllers.get(conversationId)
    if (existing !== undefined) return work(existing.signal)
    const controller = new AbortController()
    this.#controllers.set(conversationId, controller)
    try {
      return await work(controller.signal)
    } finally {
      // Only the owner removes the entry: a nested call that reused the signal
      // must not release a run it does not own.
      if (this.#controllers.get(conversationId) === controller) {
        this.#controllers.delete(conversationId)
      }
    }
  }

  /** Aborts the run in flight for the conversation, if any. */
  cancel(conversationId: ConversationId): boolean {
    const controller = this.#controllers.get(conversationId)
    if (controller === undefined) return false
    controller.abort()
    return true
  }

  isRunning(conversationId: ConversationId): boolean {
    return this.#controllers.has(conversationId)
  }
}
