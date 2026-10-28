/**
 * @file createInfoEntry
 * @description Creates one information entry: validates the field record for the
 * module, derives the title, appends the entry at the end of its module and
 * records the reversible change in the same transaction.
 *
 * Constraints:
 * - The field record is validated by the module schema, never trusted from the
 *   caller: the interface, the agent and the fixtures all go through this rule.
 * - The new entry is the last one of its module; a module with no entries starts
 *   at order 1.
 */

import type { InfoEntry } from '../../domain/info/InfoEntry'
import { deriveEntryTitle } from '../../domain/info/InfoEntry'
import { validateFieldValues } from '../../domain/info/InfoFieldValue'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import { moduleDescriptor } from '../../domain/info/InfoModuleKind'
import type { ChangeRecord } from '../../domain/changes/ChangeRecord'
import type { InfoOrigin } from '../../domain/info/InfoEntry'
import type {
  AgentRunId,
  ConversationId,
  CustomModuleId,
} from '../../domain/shared/branded-id'
import { asInfoEntryId } from '../../domain/shared/branded-id'
import type { InfoLibraryDeps } from './library'
import {
  buildChangeRecord,
  nextSortOrder,
  resolveModuleDefinition,
  resolveSourceRunId,
} from './library'

export interface CreateInfoEntryInput {
  readonly moduleKind: InfoModuleKind
  readonly customModuleId?: CustomModuleId | null
  readonly fields: Readonly<Record<string, unknown>>
  /** Who writes the entry; an agent write must name its run. */
  readonly origin: InfoOrigin
  readonly sourceRunId?: AgentRunId | null
  readonly conversationId?: ConversationId | null
}

export interface CreateInfoEntryOutput {
  readonly entry: InfoEntry
  readonly change: ChangeRecord
}

export async function createInfoEntry(
  deps: InfoLibraryDeps,
  input: CreateInfoEntryInput,
): Promise<CreateInfoEntryOutput> {
  const customModuleId = input.customModuleId ?? null
  const definition = await resolveModuleDefinition(deps, input.moduleKind, customModuleId)
  const fields = validateFieldValues(input.moduleKind, definition, input.fields)
  const sourceRunId = resolveSourceRunId(input.origin, input.sourceRunId, 'infoEntry', '')
  const existing = await deps.entries.listByModule(input.moduleKind, customModuleId)
  const now = deps.clock.now()
  const entry: InfoEntry = {
    id: asInfoEntryId(deps.ids.next()),
    moduleKind: input.moduleKind,
    customModuleId,
    title: deriveEntryTitle(input.moduleKind, definition, fields),
    fields,
    sortOrder: nextSortOrder(existing),
    origin: input.origin,
    sourceRunId,
    createdAt: now,
    updatedAt: now,
  }
  const moduleLabel = moduleDescriptor(input.moduleKind, definition).label
  const change = buildChangeRecord(deps, {
    entity: 'infoEntry',
    entityId: entry.id,
    op: 'infoEntry.create',
    beforeJson: null,
    afterJson: JSON.stringify(entry),
    origin: input.origin,
    runId: sourceRunId,
    conversationId: input.conversationId ?? null,
    label: `新增${moduleLabel}：${entry.title}`,
  })
  await deps.entries.insert(entry, change)
  return { entry, change }
}
