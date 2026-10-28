/**
 * @file reorderInfoEntries
 * @description Rewrites the order of one module's entries from a user-supplied
 * sequence. The identifier set must be exactly the module's current set; a list
 * that lost or gained an identifier is refused rather than partially applied.
 *
 * Constraints:
 * - The new order is dense 1..n. Deletions may have left gaps, and a reorder is
 *   the operation that compacts them.
 * - The change record carries both mappings, so the inverse can restore the old
 *   order without recomputing it.
 */

import type { ChangeOrigin, ChangeRecord } from '../../domain/changes/ChangeRecord'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import { moduleDescriptor } from '../../domain/info/InfoModuleKind'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type {
  AgentRunId,
  ConversationId,
  CustomModuleId,
  InfoEntryId,
} from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import type { InfoLibraryDeps } from './library'
import {
  buildChangeRecord,
  resolveModuleDefinition,
  resolveSourceRunId,
} from './library'

export interface ReorderInfoEntriesInput {
  readonly moduleKind: InfoModuleKind
  readonly customModuleId?: CustomModuleId | null
  readonly orderedEntryIds: readonly InfoEntryId[]
  readonly origin?: ChangeOrigin
  readonly sourceRunId?: AgentRunId | null
  readonly conversationId?: ConversationId | null
}

export interface ReorderInfoEntriesOutput {
  readonly entries: readonly InfoEntry[]
  readonly change: ChangeRecord
}

interface OrderMapping {
  readonly id: InfoEntryId
  readonly sortOrder: number
}

export async function reorderInfoEntries(
  deps: InfoLibraryDeps,
  input: ReorderInfoEntriesInput,
): Promise<ReorderInfoEntriesOutput> {
  const customModuleId = input.customModuleId ?? null
  const definition = await resolveModuleDefinition(deps, input.moduleKind, customModuleId)
  const current = await deps.entries.listByModule(input.moduleKind, customModuleId)
  assertSameEntrySet(current, input.orderedEntryIds)
  const origin = input.origin ?? 'user'
  const sourceRunId = resolveSourceRunId(origin, input.sourceRunId, 'infoEntry', '')
  const before: readonly OrderMapping[] = current.map((entry) => ({
    id: entry.id,
    sortOrder: entry.sortOrder,
  }))
  const after: readonly OrderMapping[] = input.orderedEntryIds.map((id, index) => ({
    id,
    sortOrder: index + 1,
  }))
  const moduleLabel = moduleDescriptor(input.moduleKind, definition).label
  // The record is keyed by the module, so an undo sees the newest reorder of the
  // same module rather than a library-wide sequence of unrelated orders.
  const change = buildChangeRecord(deps, {
    entity: 'infoEntry',
    entityId: customModuleId ?? input.moduleKind,
    op: 'infoEntry.reorder',
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(after),
    origin,
    runId: sourceRunId,
    conversationId: input.conversationId ?? null,
    label: `调整${moduleLabel}顺序`,
  })
  await deps.entries.reorder(input.moduleKind, customModuleId, input.orderedEntryIds, change)
  const byId = new Map(current.map((entry) => [entry.id, entry]))
  const reordered = input.orderedEntryIds.map((id, index) => ({
    ...byId.get(id)!,
    sortOrder: index + 1,
  }))
  return { entries: reordered, change }
}

/**
 * @throws DomainError `entryNotFound` when the requested sequence is not exactly
 *   the module's entries; the blockers name the identifiers that differ.
 */
function assertSameEntrySet(
  current: readonly InfoEntry[],
  requested: readonly InfoEntryId[],
): void {
  const requestedSet = new Set(requested)
  const currentSet = new Set(current.map((entry) => entry.id))
  const unknown = requested.filter((id) => !currentSet.has(id))
  const omitted = current.filter((entry) => !requestedSet.has(entry.id)).map((entry) => entry.id)
  const duplicated = requested.filter((id, index) => requested.indexOf(id) !== index)
  if (unknown.length === 0 && omitted.length === 0 && duplicated.length === 0) return
  const blockers = [...new Set([...unknown, ...omitted, ...duplicated])]
  throw new DomainError(
    'entryNotFound',
    'The reorder must list exactly the entries of the module.',
    { entity: 'infoEntry', id: requested[0] ?? '', blockers },
  )
}
