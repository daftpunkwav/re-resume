/**
 * @file orderedRows
 * @description Dense sort-order rewrites for the two ordered information tables.
 * The unique order index means a simple loop of `UPDATE` statements can collide
 * with a value that has not been moved yet, so the rewrite runs in two passes:
 * every row moves above the current maximum, then the target positions are
 * applied.
 *
 * Constraints:
 * - The requested identifier set must equal the current set of the scope. A
 *   caller that read the list and then lost a row would otherwise rewrite a
 *   partial order while the change record claims a full one.
 * - Only the two internal targets below are rewritten; the SQL text is fixed.
 */

import type { InfoModuleKind } from '../../../domain/info/InfoModuleKind'
import type { CustomModuleId, InfoEntryId } from '../../../domain/shared/branded-id'
import type { SqlDatabase } from '../sqlite'

interface OrderTarget {
  readonly selectIdsSql: string
  readonly maxSql: string
  readonly updateSql: string
}

const ENTRY_ORDER: OrderTarget = {
  selectIdsSql:
    "SELECT id FROM info_entry WHERE module_kind = $1 AND IFNULL(custom_module_id, '') = $2",
  maxSql:
    'SELECT MAX(sort_order) AS max_order FROM info_entry ' +
    "WHERE module_kind = $1 AND IFNULL(custom_module_id, '') = $2",
  updateSql:
    'UPDATE info_entry SET sort_order = $1 WHERE id = $2 ' +
    "AND module_kind = $3 AND IFNULL(custom_module_id, '') = $4",
}

const MODULE_ORDER: OrderTarget = {
  selectIdsSql: 'SELECT id FROM custom_module',
  maxSql: 'SELECT MAX(sort_order) AS max_order FROM custom_module',
  updateSql: 'UPDATE custom_module SET sort_order = $1 WHERE id = $2',
}

function assertSameIdentifiers(
  what: string,
  current: readonly string[],
  requested: readonly string[],
): void {
  const unique = new Set(requested)
  if (unique.size !== requested.length) {
    throw new Error(`Cannot rewrite the sort order of ${what}: an identifier is listed twice.`)
  }
  if (current.length !== requested.length) {
    throw new Error(
      `Cannot rewrite the sort order of ${what}: ${current.length.toString()} rows are stored, ` +
        `${requested.length.toString()} were requested.`,
    )
  }
  const currentSet = new Set(current)
  for (const id of requested) {
    if (!currentSet.has(id)) {
      throw new Error(`Cannot rewrite the sort order of ${what}: "${id}" is not part of it.`)
    }
  }
}

async function currentIdentifiers(
  database: SqlDatabase,
  target: OrderTarget,
  scope: readonly string[],
): Promise<readonly string[]> {
  const rows = await database.select<{ readonly id: unknown }>(target.selectIdsSql, scope)
  return rows.map((row) => {
    if (typeof row.id !== 'string') {
      throw new Error('Cannot rewrite the sort order: a stored identifier is not text.')
    }
    return row.id
  })
}

async function highestSortOrder(
  database: SqlDatabase,
  target: OrderTarget,
  scope: readonly string[],
): Promise<number> {
  const rows = await database.select<{ readonly max_order: unknown }>(target.maxSql, scope)
  const maximum = rows[0]?.max_order
  return typeof maximum === 'number' ? maximum : 0
}

/**
 * Two-pass rewrite. The first pass parks every row above the highest stored
 * order, which frees every position in the scope; the second pass writes 1..n.
 */
async function applyDenseOrder(
  database: SqlDatabase,
  target: OrderTarget,
  orderedIds: readonly string[],
  scope: readonly string[],
): Promise<void> {
  const current = await currentIdentifiers(database, target, scope)
  assertSameIdentifiers('the ordered rows', current, orderedIds)
  if (orderedIds.length === 0) return
  await parkRows(database, target, orderedIds, scope)
  await writeDensePositions(database, target, orderedIds, scope)
}

/** First pass: move every row above the highest stored order. */
async function parkRows(
  database: SqlDatabase,
  target: OrderTarget,
  orderedIds: readonly string[],
  scope: readonly string[],
): Promise<void> {
  let parked = (await highestSortOrder(database, target, scope)) + 1
  for (const id of orderedIds) {
    await updateSingleOrder(database, target, id, parked, scope)
    parked += 1
  }
}

/** Second pass: apply the target positions. */
async function writeDensePositions(
  database: SqlDatabase,
  target: OrderTarget,
  orderedIds: readonly string[],
  scope: readonly string[],
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await updateSingleOrder(database, target, id, index + 1, scope)
  }
}

async function updateSingleOrder(
  database: SqlDatabase,
  target: OrderTarget,
  id: string,
  sortOrder: number,
  scope: readonly string[],
): Promise<void> {
  const result = await database.execute(target.updateSql, [sortOrder, id, ...scope])
  if (result.rowsAffected !== 1) {
    throw new Error(`Cannot rewrite the sort order: "${id}" was not updated.`)
  }
}

/**
 * Rewrites the order of one module's entries to 1..n. The caller owns the
 * transaction and appends the change record.
 */
export async function rewriteEntrySortOrder(
  database: SqlDatabase,
  moduleKind: InfoModuleKind,
  customModuleId: CustomModuleId | null,
  orderedIds: readonly InfoEntryId[],
): Promise<void> {
  await applyDenseOrder(database, ENTRY_ORDER, orderedIds, [moduleKind, customModuleId ?? ''])
}

/** Rewrites the order of the custom modules to 1..n. */
export async function rewriteModuleSortOrder(
  database: SqlDatabase,
  orderedIds: readonly CustomModuleId[],
): Promise<void> {
  await applyDenseOrder(database, MODULE_ORDER, orderedIds, [])
}
