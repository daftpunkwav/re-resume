/**
 * @file deleteInfoEntry
 * @description Deletes one information entry after the caller has confirmed the
 * resumes that still reference it. The delete is hard: a resume that selected the
 * entry keeps the identifier and reports it as a missing reference, which is what
 * keeps the deletion from silently rewriting a resume.
 *
 * Constraints:
 * - The use case asks the injected reference query, never the resume model, so the
 *   library layer stays independent of composition.
 * - A refusal names the resumes in `detail.blockers` so the interface can show
 *   what the confirmation is about.
 * - The order of the remaining entries is not compacted: gaps are allowed by the
 *   model, and renumbering would rewrite rows the user did not change.
 */

import type { ChangeRecord } from '../../domain/changes/ChangeRecord'
import type { InfoOrigin } from '../../domain/info/InfoEntry'
import { moduleDescriptor } from '../../domain/info/InfoModuleKind'
import type { InfoEntryReference } from '../../domain/info/ports/InfoEntryReferenceQuery'
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

export interface DeleteInfoEntryInput {
  readonly entryId: InfoEntryId
  /** Confirmation that the caller saw the referencing resumes. */
  readonly confirmReferenced: boolean
  /** Defaults to a user deletion; the agent has no delete tool, but the record keeps provenance. */
  readonly origin?: InfoOrigin
  readonly sourceRunId?: AgentRunId | null
  readonly conversationId?: ConversationId | null
}

export interface DeleteInfoEntryOutput {
  /** Resume sections that still select the deleted entry. */
  readonly referencedBy: readonly InfoEntryReference[]
  readonly change: ChangeRecord
}

export async function deleteInfoEntry(
  deps: InfoLibraryDeps,
  input: DeleteInfoEntryInput,
): Promise<DeleteInfoEntryOutput> {
  const entry = await deps.entries.findById(input.entryId)
  if (entry === null) {
    throw new DomainError('entryNotFound', 'The information entry does not exist.', {
      entity: 'infoEntry',
      id: input.entryId,
      blockers: [input.entryId],
    })
  }
  const referencedBy = await deps.references.listEntryReferences(input.entryId)
  if (referencedBy.length > 0 && !input.confirmReferenced) {
    throw new DomainError(
      'entryReferenced',
      'The information entry is still selected by a resume; confirmation is required.',
      {
        entity: 'infoEntry',
        id: input.entryId,
        blockers: referencedBy.map((reference) => reference.resumeId),
      },
    )
  }
  const definition = await definitionOfEntry(deps, entry)
  const origin = input.origin ?? 'user'
  const sourceRunId = resolveSourceRunId(origin, input.sourceRunId, 'infoEntry', entry.id)
  const moduleLabel = moduleDescriptor(entry.moduleKind, definition).label
  const change = buildChangeRecord(deps, {
    entity: 'infoEntry',
    entityId: entry.id,
    op: 'infoEntry.delete',
    beforeJson: JSON.stringify(entry),
    afterJson: null,
    origin,
    runId: sourceRunId,
    conversationId: input.conversationId ?? null,
    label: `删除${moduleLabel}：${entry.title}`,
  })
  await deps.entries.delete(entry.id, change)
  return { referencedBy, change }
}
