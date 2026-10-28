/**
 * @file ChangeRecord
 * @description The reversible record of one information-library or job-posting
 * write. The resume side of the application is undone by moving along its
 * revision chain; every other structured write is undone by applying the inverse
 * of one of these records, newest first.
 *
 * Responsibilities:
 * - Declare the append-only record, its scopes and its operations
 * - Carry the before/after payloads the inverse operation replays
 * - Keep provenance (origin, run, conversation) beside the operation
 *
 * Constraints:
 * - Append-only: a normal write inserts a record; undoing one stamps
 *   `undoneAt` on it rather than deleting or replacing it.
 * - `beforeJson` and `afterJson` are opaque serialised payloads. Their shapes
 *   belong to the operation; the record itself never interprets them.
 * - This module is pure: no DOM, no storage, no package.
 */

import type {
  AgentRunId,
  ChangeRecordId,
  ConversationId,
} from '../shared/branded-id'
import type { DateTime } from '../shared/DateTime'

export const CHANGE_SCOPES = ['library', 'jobPosting'] as const

export type ChangeScope = (typeof CHANGE_SCOPES)[number]

export const CHANGE_OPS = [
  'infoEntry.create',
  'infoEntry.update',
  'infoEntry.delete',
  'infoEntry.reorder',
  'customModule.create',
  'customModule.update',
  'customModule.delete',
  'customModule.reorder',
  'jobPosting.create',
] as const

export type ChangeOp = (typeof CHANGE_OPS)[number]

export const CHANGE_ORIGINS = ['user', 'agent'] as const

/** Who performed the write. */
export type ChangeOrigin = (typeof CHANGE_ORIGINS)[number]

export interface ChangeRecord {
  readonly id: ChangeRecordId
  readonly scope: ChangeScope
  /** Entity family the record belongs to: 'infoEntry', 'customModule' or 'jobPosting'. */
  readonly entity: string
  readonly entityId: string
  readonly op: ChangeOp
  /**
   * The state before the write: null for a creation, and the removed state for a
   * deletion — which is what the inverse of a deletion replays.
   */
  readonly beforeJson: string | null
  /** The state after the write; null for a deletion. */
  readonly afterJson: string | null
  readonly origin: ChangeOrigin
  readonly runId: AgentRunId | null
  readonly conversationId: ConversationId | null
  /** User-facing short description, for example「新增项目经历：订单中台」. */
  readonly label: string
  readonly undoneAt: DateTime | null
  readonly createdAt: DateTime
}

export function isChangeScope(value: unknown): value is ChangeScope {
  return value === 'library' || value === 'jobPosting'
}

export function isChangeOp(value: unknown): value is ChangeOp {
  return typeof value === 'string' && (CHANGE_OPS as readonly string[]).includes(value)
}

export function isChangeOrigin(value: unknown): value is ChangeOrigin {
  return value === 'user' || value === 'agent'
}
