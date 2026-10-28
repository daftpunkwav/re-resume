/**
 * @file updateInfoEntry
 * @description Replaces the field record of one entry. The whole record is
 * replaced — an omitted optional field becomes null — while the identity,
 * origin, order and creation time stay as they were.
 *
 * Constraints:
 * - The entry keeps the origin of the write that created it; the change record
 *   carries the origin of this update, so provenance of the edit is not lost.
 * - The title is derived again from the new record.
 */

import type { InfoEntry, InfoOrigin } from '../../domain/info/InfoEntry'
import { deriveEntryTitle } from '../../domain/info/InfoEntry'
import { validateFieldValues } from '../../domain/info/InfoFieldValue'
import { moduleDescriptor } from '../../domain/info/InfoModuleKind'
import type { ChangeRecord } from '../../domain/changes/ChangeRecord'
import type {
  AgentRunId,
  ConversationId,
  InfoEntryId,
} from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import type { InfoLibraryDeps } from './library'
import {
  buildChangeRecord,
  definitionOfEntry,
  resolveSourceRunId,
} from './library'

export interface UpdateInfoEntryInput {
  readonly entryId: InfoEntryId
  readonly fields: Readonly<Record<string, unknown>>
  /** Defaults to a user edit; the agent passes `agent` with its run. */
  readonly origin?: InfoOrigin
  readonly sourceRunId?: AgentRunId | null
  readonly conversationId?: ConversationId | null
}

export interface UpdateInfoEntryOutput {
  readonly entry: InfoEntry
  readonly change: ChangeRecord
}

export async function updateInfoEntry(
  deps: InfoLibraryDeps,
  input: UpdateInfoEntryInput,
): Promise<UpdateInfoEntryOutput> {
  const current = await deps.entries.findById(input.entryId)
  if (current === null) {
    throw new DomainError('entryNotFound', 'The information entry does not exist.', {
      entity: 'infoEntry',
      id: input.entryId,
      blockers: [input.entryId],
    })
  }
  const definition = await definitionOfEntry(deps, current)
  const fields = validateFieldValues(current.moduleKind, definition, input.fields)
  const origin = input.origin ?? 'user'
  const sourceRunId = resolveSourceRunId(origin, input.sourceRunId, 'infoEntry', current.id)
  const updated: InfoEntry = {
    ...current,
    title: deriveEntryTitle(current.moduleKind, definition, fields),
    fields,
    updatedAt: deps.clock.now(),
  }
  const moduleLabel = moduleDescriptor(current.moduleKind, definition).label
  const change = buildChangeRecord(deps, {
    entity: 'infoEntry',
    entityId: updated.id,
    op: 'infoEntry.update',
    beforeJson: JSON.stringify(current),
    afterJson: JSON.stringify(updated),
    origin,
    runId: sourceRunId,
    conversationId: input.conversationId ?? null,
    label: `更新${moduleLabel}：${updated.title}`,
  })
  await deps.entries.update(updated, change)
  return { entry: updated, change }
}
