/**
 * @file deleteCustomModule
 * @description Deletes a custom module after the caller has confirmed the entries
 * that go with it. The entries are deleted in the same transaction as the
 * definition; resume sections that referenced the module are not touched, because
 * a missing reference is reported rather than silently rewritten.
 *
 * Constraints:
 * - Confirmation is required while the module still owns entries, and the refusal
 *   reports both the entry count and the referencing section count so the
 *   interface can describe what is about to happen.
 * - The change record carries the definition and every entry as they were, which
 *   is everything the inverse needs to recreate them.
 */

import type { ChangeOrigin, ChangeRecord } from '../../domain/changes/ChangeRecord'
import type { InfoEntryReference } from '../../domain/info/ports/InfoEntryReferenceQuery'
import type {
  AgentRunId,
  ConversationId,
  CustomModuleId,
} from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import type { InfoLibraryDeps } from './library'
import { buildChangeRecord, resolveSourceRunId } from './library'

export interface DeleteCustomModuleInput {
  readonly moduleId: CustomModuleId
  /** Confirmation that the caller saw the cascade and the referencing sections. */
  readonly confirmEntries: boolean
  readonly origin?: ChangeOrigin
  readonly sourceRunId?: AgentRunId | null
  readonly conversationId?: ConversationId | null
}

export interface DeleteCustomModuleOutput {
  /** Entries deleted together with the definition. */
  readonly entryCount: number
  /** Resume sections that still reference the deleted module. */
  readonly referencedBy: readonly InfoEntryReference[]
  readonly change: ChangeRecord
}

export async function deleteCustomModule(
  deps: InfoLibraryDeps,
  input: DeleteCustomModuleInput,
): Promise<DeleteCustomModuleOutput> {
  const module = await deps.customModules.findById(input.moduleId)
  if (module === null) {
    throw new DomainError('customModuleNotFound', 'The custom module does not exist.', {
      entity: 'customModule',
      id: input.moduleId,
      blockers: [input.moduleId],
    })
  }
  const entries = await deps.entries.listByModule('custom', input.moduleId)
  const referencedBy = await deps.references.listModuleReferences(input.moduleId)
  if (entries.length > 0 && !input.confirmEntries) {
    throw new DomainError(
      'entryReferenced',
      `The custom module still owns ${entries.length.toString()} entries; confirmation is required.`,
      {
        entity: 'customModule',
        id: input.moduleId,
        blockers: [
          `entries:${entries.length.toString()}`,
          `sections:${referencedBy.length.toString()}`,
          ...new Set(referencedBy.map((reference) => reference.resumeId)),
        ],
      },
    )
  }
  const origin = input.origin ?? 'user'
  const sourceRunId = resolveSourceRunId(origin, input.sourceRunId, 'customModule', module.id)
  const change = buildChangeRecord(deps, {
    entity: 'customModule',
    entityId: module.id,
    op: 'customModule.delete',
    beforeJson: JSON.stringify({ module, entries }),
    afterJson: null,
    origin,
    runId: sourceRunId,
    conversationId: input.conversationId ?? null,
    label: `删除自定义模块：${module.name}`,
  })
  await deps.customModules.delete(module.id, entries, change)
  return { entryCount: entries.length, referencedBy, change }
}
