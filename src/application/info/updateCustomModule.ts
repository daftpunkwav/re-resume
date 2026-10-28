/**
 * @file updateCustomModule
 * @description Renames a custom module and/or changes its field list. A field
 * keeps its key for life: renaming changes only the label. Adding a field appends
 * a newly keyed definition; removing one must be confirmed and clears the stored
 * values in the same transaction.
 *
 * Constraints:
 * - The type, required flag and declared maximum of a kept field cannot change:
 *   stored values were validated against the field as it was declared, and
 *   silently reinterpreting them is how a library stops being trustworthy.
 * - The change record carries the definition before the update plus the values
 *   the update clears, so the inverse can restore both.
 */

import type { ChangeOrigin, ChangeRecord } from '../../domain/changes/ChangeRecord'
import type {
  CustomFieldDefinition,
  CustomFieldType,
  CustomModuleDefinition,
} from '../../domain/info/CustomModule'
import {
  nextCustomFieldKey,
  normalizeCustomModuleName,
  validateCustomFieldDefinition,
  validateCustomModuleDefinition,
} from '../../domain/info/CustomModule'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import type {
  AgentRunId,
  ConversationId,
  CustomFieldKey,
  CustomModuleId,
  InfoEntryId,
} from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import type { InfoLibraryDeps } from './library'
import { buildChangeRecord, resolveSourceRunId } from './library'
import { assertNameAvailable } from './createCustomModule'

export interface CustomFieldUpdate {
  /** Present for a field that already exists; absent for a newly added field. */
  readonly key?: CustomFieldKey
  readonly label: string
  readonly type: CustomFieldType
  readonly required: boolean
  readonly maxLength: number
}

export interface UpdateCustomModuleInput {
  readonly moduleId: CustomModuleId
  readonly name?: string
  /** Full replacement list, in form order. Omitted keeps the current fields. */
  readonly fields?: readonly CustomFieldUpdate[]
  /** Required when removing a field whose stored value is not empty. */
  readonly confirmValuesLoss?: boolean
  readonly origin?: ChangeOrigin
  readonly sourceRunId?: AgentRunId | null
  readonly conversationId?: ConversationId | null
}

export interface UpdateCustomModuleOutput {
  readonly module: CustomModuleDefinition
  /** Entries whose removed values were cleared, in the same transaction. */
  readonly clearedEntryCount: number
  readonly change: ChangeRecord
}

/** A cleared value recorded in the change payload so the inverse can restore it. */
interface ClearedValue {
  readonly entryId: InfoEntryId
  readonly fieldKey: CustomFieldKey
  readonly value: string
}

export async function updateCustomModule(
  deps: InfoLibraryDeps,
  input: UpdateCustomModuleInput,
): Promise<UpdateCustomModuleOutput> {
  const current = await deps.customModules.findById(input.moduleId)
  if (current === null) {
    throw new DomainError('customModuleNotFound', 'The custom module does not exist.', {
      entity: 'customModule',
      id: input.moduleId,
      blockers: [input.moduleId],
    })
  }
  const allModules = await deps.customModules.listAll()
  const name =
    input.name === undefined ? current.name : normalizeCustomModuleName(input.name)
  if (input.name !== undefined) assertNameAvailable(name, allModules, current.id)
  const fields =
    input.fields === undefined ? current.fields : buildFields(deps, current, input.fields)
  const updated: CustomModuleDefinition = {
    ...current,
    name,
    fields,
    updatedAt: deps.clock.now(),
  }
  validateCustomModuleDefinition(updated)
  const removedKeys = new Set(
    current.fields
      .filter((field) => !fields.some((kept) => kept.key === field.key))
      .map((field) => field.key),
  )
  const entries = removedKeys.size === 0 ? [] : await entriesOfModule(deps, current.id)
  const clearedValues = collectClearedValues(entries, removedKeys)
  if (clearedValues.length > 0 && input.confirmValuesLoss !== true) {
    throw new DomainError(
      'fieldRemovalBlocked',
      'A removed field still holds values; confirmation is required to clear them.',
      {
        entity: 'customModule',
        id: current.id,
        blockers: [...new Set(clearedValues.map((cleared) => cleared.entryId))],
      },
    )
  }
  const origin = input.origin ?? 'user'
  const sourceRunId = resolveSourceRunId(origin, input.sourceRunId, 'customModule', current.id)
  const change = buildChangeRecord(deps, {
    entity: 'customModule',
    entityId: current.id,
    op: 'customModule.update',
    beforeJson: JSON.stringify({ module: current, clearedValues }),
    afterJson: JSON.stringify(updated),
    origin,
    runId: sourceRunId,
    conversationId: input.conversationId ?? null,
    label: `更新自定义模块：${updated.name}`,
  })
  await deps.customModules.update(
    updated,
    clearedValues.map((cleared) => ({
      entryId: cleared.entryId,
      fieldKey: cleared.fieldKey,
    })),
    change,
  )
  return {
    module: updated,
    clearedEntryCount: new Set(clearedValues.map((cleared) => cleared.entryId)).size,
    change,
  }
}

/**
 * Builds the replacement field list. A kept field takes its label from the input
 * and everything else from the current definition; a new field gets a fresh key.
 */
function buildFields(
  deps: InfoLibraryDeps,
  current: CustomModuleDefinition,
  updates: readonly CustomFieldUpdate[],
): readonly CustomFieldDefinition[] {
  const currentByKey = new Map(current.fields.map((field) => [field.key as string, field]))
  const seen = new Set<string>()
  const fields: CustomFieldDefinition[] = []
  for (const update of updates) {
    const existingKey = update.key
    if (existingKey === undefined) {
      const added: CustomFieldDefinition = {
        key: nextCustomFieldKey(deps.ids),
        label: update.label.trim(),
        type: update.type,
        required: update.required,
        maxLength: update.maxLength,
      }
      validateCustomFieldDefinition(added)
      fields.push(added)
      continue
    }
    const existing = currentByKey.get(existingKey)
    if (existing === undefined) {
      throw new DomainError(
        'unknownField',
        `The field "${existingKey}" is not part of this module.`,
        { entity: 'customModule', id: current.id, blockers: [existingKey] },
      )
    }
    if (seen.has(existingKey)) {
      throw new DomainError('duplicateFieldKey', `The field "${existingKey}" is listed twice.`, {
        entity: 'customModule',
        id: current.id,
        blockers: [existingKey],
      })
    }
    seen.add(existingKey)
    if (
      update.type !== existing.type ||
      update.required !== existing.required ||
      update.maxLength !== existing.maxLength
    ) {
      throw new DomainError(
        'invalidFieldValue',
        `The shape of the field "${existingKey}" cannot change; only its label can.`,
        { entity: 'customModule', id: current.id, blockers: [existingKey] },
      )
    }
    const renamed: CustomFieldDefinition = { ...existing, label: update.label.trim() }
    validateCustomFieldDefinition(renamed)
    fields.push(renamed)
  }
  return fields
}

async function entriesOfModule(
  deps: InfoLibraryDeps,
  moduleId: CustomModuleId,
): Promise<readonly InfoEntry[]> {
  return deps.entries.listByModule('custom', moduleId)
}

/** Values of the removed keys that are not empty, with the value the inverse restores. */
function collectClearedValues(
  entries: readonly InfoEntry[],
  removedKeys: ReadonlySet<CustomFieldKey>,
): readonly ClearedValue[] {
  const cleared: ClearedValue[] = []
  for (const entry of entries) {
    for (const key of removedKeys) {
      const value = entry.fields[key]
      if (typeof value === 'string' && value !== '') {
        cleared.push({ entryId: entry.id, fieldKey: key, value })
      }
    }
  }
  return cleared
}
