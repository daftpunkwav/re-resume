/**
 * @file createCustomModule
 * @description Creates a user-defined module: validates the name and the declared
 * fields, allocates immutable field keys, appends the definition and records the
 * change.
 *
 * Constraints:
 * - The library-wide bounds are checked here because they need the current
 *   collection: at most twenty modules and a case-insensitive unique name.
 * - Field keys are generated from the identifier source and never accepted from
 *   input; a caller cannot pick a key that collides with a future one.
 */

import type { ChangeOrigin, ChangeRecord } from '../../domain/changes/ChangeRecord'
import type {
  CustomFieldDefinition,
  CustomFieldType,
  CustomModuleDefinition,
} from '../../domain/info/CustomModule'
import {
  CUSTOM_MODULE_LIMIT,
  nextCustomFieldKey,
  normalizeCustomModuleName,
  validateCustomFieldDefinition,
  validateCustomModuleDefinition,
} from '../../domain/info/CustomModule'
import type {
  AgentRunId,
  ConversationId,
  CustomModuleId,
} from '../../domain/shared/branded-id'
import { asCustomModuleId } from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import type { InfoLibraryDeps } from './library'
import { buildChangeRecord, resolveSourceRunId } from './library'

export interface CustomFieldInput {
  readonly label: string
  readonly type: CustomFieldType
  readonly required: boolean
  readonly maxLength: number
}

export interface CreateCustomModuleInput {
  readonly name: string
  readonly fields: readonly CustomFieldInput[]
  readonly origin?: ChangeOrigin
  readonly sourceRunId?: AgentRunId | null
  readonly conversationId?: ConversationId | null
}

export interface CreateCustomModuleOutput {
  readonly module: CustomModuleDefinition
  readonly change: ChangeRecord
}

export async function createCustomModule(
  deps: InfoLibraryDeps,
  input: CreateCustomModuleInput,
): Promise<CreateCustomModuleOutput> {
  const existing = await deps.customModules.listAll()
  if (existing.length >= CUSTOM_MODULE_LIMIT) {
    throw new DomainError(
      'customModuleLimit',
      `The library holds at most ${CUSTOM_MODULE_LIMIT.toString()} custom modules.`,
      { entity: 'customModule', id: '', blockers: [] },
    )
  }
  const name = normalizeCustomModuleName(input.name)
  assertNameAvailable(name, existing, null)
  const fields: CustomFieldDefinition[] = input.fields.map((field) => {
    const definition: CustomFieldDefinition = {
      key: nextCustomFieldKey(deps.ids),
      label: field.label.trim(),
      type: field.type,
      required: field.required,
      maxLength: field.maxLength,
    }
    validateCustomFieldDefinition(definition)
    return definition
  })
  const now = deps.clock.now()
  const module: CustomModuleDefinition = {
    id: asCustomModuleId(deps.ids.next()),
    name,
    fields,
    sortOrder: highestSortOrder(existing) + 1,
    createdAt: now,
    updatedAt: now,
  }
  validateCustomModuleDefinition(module)
  const origin = input.origin ?? 'user'
  const sourceRunId = resolveSourceRunId(origin, input.sourceRunId, 'customModule', module.id)
  const change = buildChangeRecord(deps, {
    entity: 'customModule',
    entityId: module.id,
    op: 'customModule.create',
    beforeJson: null,
    afterJson: JSON.stringify(module),
    origin,
    runId: sourceRunId,
    conversationId: input.conversationId ?? null,
    label: `新增自定义模块：${module.name}`,
  })
  await deps.customModules.insert(module, change)
  return { module, change }
}

/**
 * @throws DomainError `invalidFieldValue` when another module already holds the
 *   name; the library rule compares case-insensitively.
 */
export function assertNameAvailable(
  name: string,
  existing: readonly CustomModuleDefinition[],
  exceptId: CustomModuleId | null,
): void {
  const normalized = name.toLowerCase()
  const taken = existing.some(
    (module) => module.id !== exceptId && module.name.toLowerCase() === normalized,
  )
  if (taken) {
    throw new DomainError('invalidFieldValue', `The name "${name}" is already used.`, {
      entity: 'customModule',
      id: exceptId ?? '',
      blockers: [name],
    })
  }
}

/** One past the highest stored order; an empty library starts at 1. */
function highestSortOrder(modules: readonly CustomModuleDefinition[]): number {
  let highest = 0
  for (const module of modules) highest = Math.max(highest, module.sortOrder)
  return highest
}
