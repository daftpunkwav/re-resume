/**
 * @file reorderCustomModules
 * @description Rewrites the order of the custom modules from a user-supplied
 * sequence. The identifier set must be exactly the current set; a list that lost
 * or gained a module is refused rather than partially applied.
 *
 * Constraints:
 * - The new order is dense 1..n, matching the unique order column.
 * - The change record carries both mappings so the inverse restores the old order.
 */

import type { ChangeOrigin, ChangeRecord } from '../../domain/changes/ChangeRecord'
import type { CustomModuleDefinition } from '../../domain/info/CustomModule'
import type {
  AgentRunId,
  ConversationId,
  CustomModuleId,
} from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import type { InfoLibraryDeps } from './library'
import { buildChangeRecord, resolveSourceRunId } from './library'

export interface ReorderCustomModulesInput {
  readonly orderedModuleIds: readonly CustomModuleId[]
  readonly origin?: ChangeOrigin
  readonly sourceRunId?: AgentRunId | null
  readonly conversationId?: ConversationId | null
}

export interface ReorderCustomModulesOutput {
  readonly modules: readonly CustomModuleDefinition[]
  readonly change: ChangeRecord
}

interface OrderMapping {
  readonly id: CustomModuleId
  readonly sortOrder: number
}

export async function reorderCustomModules(
  deps: InfoLibraryDeps,
  input: ReorderCustomModulesInput,
): Promise<ReorderCustomModulesOutput> {
  const current = await deps.customModules.listAll()
  assertSameModuleSet(current, input.orderedModuleIds)
  const origin = input.origin ?? 'user'
  const sourceRunId = resolveSourceRunId(origin, input.sourceRunId, 'customModule', '')
  const before: readonly OrderMapping[] = current.map((module) => ({
    id: module.id,
    sortOrder: module.sortOrder,
  }))
  const after: readonly OrderMapping[] = input.orderedModuleIds.map((id, index) => ({
    id,
    sortOrder: index + 1,
  }))
  // A collection-level operation: the identifier names the ordered collection,
  // so the record is not attributed to one of the modules it reorders.
  const change = buildChangeRecord(deps, {
    entity: 'customModule',
    entityId: 'customModules',
    op: 'customModule.reorder',
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(after),
    origin,
    runId: sourceRunId,
    conversationId: input.conversationId ?? null,
    label: '调整自定义模块顺序',
  })
  await deps.customModules.reorder(input.orderedModuleIds, change)
  const byId = new Map(current.map((module) => [module.id, module]))
  const modules = input.orderedModuleIds.map((id) => {
    const module = byId.get(id)
    if (module === undefined) {
      throw new DomainError('customModuleNotFound', 'The custom module does not exist.', {
        entity: 'customModule',
        id,
        blockers: [id],
      })
    }
    return module
  })
  return {
    modules: modules.map((module, index) => ({ ...module, sortOrder: index + 1 })),
    change,
  }
}

/**
 * @throws DomainError `customModuleNotFound` when the sequence is not exactly the
 *   current modules; the blockers name the identifiers that differ.
 */
function assertSameModuleSet(
  current: readonly CustomModuleDefinition[],
  requested: readonly CustomModuleId[],
): void {
  const requestedSet = new Set(requested)
  const currentSet = new Set(current.map((module) => module.id))
  const unknown = requested.filter((id) => !currentSet.has(id))
  const omitted = current.filter((module) => !requestedSet.has(module.id)).map((module) => module.id)
  const duplicated = requested.filter((id, index) => requested.indexOf(id) !== index)
  if (unknown.length === 0 && omitted.length === 0 && duplicated.length === 0) return
  const blockers = [...new Set([...unknown, ...omitted, ...duplicated])]
  throw new DomainError(
    'customModuleNotFound',
    'The reorder must list exactly the custom modules of the library.',
    { entity: 'customModule', id: requested[0] ?? '', blockers },
  )
}
