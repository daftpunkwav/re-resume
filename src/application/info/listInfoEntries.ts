/**
 * @file listInfoEntries
 * @description Reads the library in one pass for the information panel: entries,
 * the per-module counts and the custom module definitions. The panel filters the
 * already-read list while the user navigates between modules, so a navigation
 * does not hit the database again.
 *
 * Constraints:
 * - Entries are ordered by module in the specification's canonical module order,
 *   then by the custom module order, then by the entry order.
 * - The summaries count the whole library regardless of an entry filter: they
 *   are what the navigation shows.
 */

import type { CustomModuleDefinition } from '../../domain/info/CustomModule'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import { INFO_MODULE_KINDS, BUILT_IN_MODULE_KINDS, moduleDescriptor } from '../../domain/info/InfoModuleKind'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type { CustomModuleId } from '../../domain/shared/branded-id'
import type { InfoLibraryDeps } from './library'

export interface ListInfoEntriesInput {
  readonly moduleKind?: InfoModuleKind
  /** Only meaningful with `moduleKind: 'custom'`; null selects built-in entries. */
  readonly customModuleId?: CustomModuleId | null
}

export interface InfoModuleSummary {
  readonly moduleKind: InfoModuleKind
  readonly customModuleId: CustomModuleId | null
  readonly label: string
  /** Entries of the whole module, before any entry filter. */
  readonly entryCount: number
}

export interface ListInfoEntriesOutput {
  readonly entries: readonly InfoEntry[]
  readonly summaries: readonly InfoModuleSummary[]
  readonly customModules: readonly CustomModuleDefinition[]
}

/** Position of a module in the canonical order the specification fixes. */
function moduleKindRank(moduleKind: InfoModuleKind): number {
  return INFO_MODULE_KINDS.indexOf(moduleKind)
}

export async function listInfoEntries(
  deps: InfoLibraryDeps,
  input: ListInfoEntriesInput = {},
): Promise<ListInfoEntriesOutput> {
  const allEntries = await deps.entries.listAll()
  const customModules = await deps.customModules.listAll()
  const filtered = filterEntries(allEntries, input)
  const customOrder = new Map(customModules.map((module) => [module.id as string, module.sortOrder]))
  const entries = [...filtered].sort((left, right) => compareEntries(left, right, customOrder))
  const summaries = buildSummaries(allEntries, customModules)
  return { entries, summaries, customModules }
}

function filterEntries(
  entries: readonly InfoEntry[],
  input: ListInfoEntriesInput,
): readonly InfoEntry[] {
  return entries.filter((entry) => {
    if (input.moduleKind !== undefined && entry.moduleKind !== input.moduleKind) return false
    if (input.customModuleId !== undefined && entry.customModuleId !== input.customModuleId) {
      return false
    }
    return true
  })
}

function compareEntries(
  left: InfoEntry,
  right: InfoEntry,
  customOrder: ReadonlyMap<string, number>,
): number {
  const kindDifference = moduleKindRank(left.moduleKind) - moduleKindRank(right.moduleKind)
  if (kindDifference !== 0) return kindDifference
  const leftOrder = left.customModuleId === null ? 0 : (customOrder.get(left.customModuleId) ?? 0)
  const rightOrder = right.customModuleId === null ? 0 : (customOrder.get(right.customModuleId) ?? 0)
  if (leftOrder !== rightOrder) return leftOrder - rightOrder
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function buildSummaries(
  entries: readonly InfoEntry[],
  customModules: readonly CustomModuleDefinition[],
): readonly InfoModuleSummary[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const key = `${entry.moduleKind}:${entry.customModuleId ?? ''}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const summaries: InfoModuleSummary[] = BUILT_IN_MODULE_KINDS.map((kind) => ({
    moduleKind: kind,
    customModuleId: null,
    label: moduleDescriptor(kind, null).label,
    entryCount: counts.get(`${kind}:`) ?? 0,
  }))
  summaries.push(
    ...customModules.map((module) => ({
      moduleKind: 'custom' as const,
      customModuleId: module.id,
      label: module.name,
      entryCount: counts.get(`custom:${module.id}`) ?? 0,
    })),
  )
  return summaries
}
