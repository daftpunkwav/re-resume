/**
 * @file library
 * @description The dependencies and shared rules of the information-library use
 * cases. Every use case is a function over this small dependency record; no use
 * case constructs infrastructure, reads the environment or touches storage
 * directly.
 *
 * Responsibilities:
 * - Declare the ports and ambient sources the library use cases receive
 * - Resolve the custom module a write names, with the contract's error codes
 * - Build the change record every write appends
 * - Derive the next sort order inside a module
 *
 * Constraints:
 * - Only ports and Clock/IdGenerator appear in the dependency record.
 * - Reference lookups stay behind `InfoEntryReferenceQuery`: the library never
 *   imports the resume model.
 */

import type { ChangeOrigin, ChangeRecord, ChangeOp } from '../../domain/changes/ChangeRecord'
import type { CustomModuleDefinition } from '../../domain/info/CustomModule'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntryReferenceQuery } from '../../domain/info/ports/InfoEntryReferenceQuery'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { Clock } from '../../domain/shared/Clock'
import { DomainError } from '../../domain/shared/DomainError'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type {
  AgentRunId,
  ConversationId,
  CustomModuleId,
} from '../../domain/shared/branded-id'
import { asChangeRecordId } from '../../domain/shared/branded-id'

export interface InfoLibraryDeps {
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly references: InfoEntryReferenceQuery
  readonly clock: Clock
  readonly ids: IdGenerator
}

function moduleKindMismatch(message: string, id: string): DomainError {
  return new DomainError('moduleKindMismatch', message, {
    entity: 'infoEntry',
    id,
    blockers: [id],
  })
}

function customModuleNotFound(id: string): DomainError {
  return new DomainError('customModuleNotFound', 'The custom module does not exist.', {
    entity: 'customModule',
    id,
    blockers: [id],
  })
}

/**
 * Resolves the module a write targets. A custom module must be named by its id;
 * a built-in module must not name one. The definition is returned for custom
 * modules because it declares the legal field keys.
 *
 * @throws DomainError `moduleKindMismatch` for an association the model does not
 *   allow, `customModuleNotFound` when the definition does not exist.
 */
export async function resolveModuleDefinition(
  deps: InfoLibraryDeps,
  moduleKind: InfoModuleKind,
  customModuleId: CustomModuleId | null,
): Promise<CustomModuleDefinition | null> {
  if (moduleKind !== 'custom') {
    if (customModuleId !== null) {
      throw moduleKindMismatch('Only a custom module entry may name a custom module.', customModuleId)
    }
    return null
  }
  if (customModuleId === null) {
    throw moduleKindMismatch('A custom module entry must name its custom module.', '')
  }
  const definition = await deps.customModules.findById(customModuleId)
  if (definition === null) throw customModuleNotFound(customModuleId)
  return definition
}

/** Resolution for an existing entry: its own module kind is authoritative. */
export async function definitionOfEntry(
  deps: InfoLibraryDeps,
  entry: InfoEntry,
): Promise<CustomModuleDefinition | null> {
  if (entry.customModuleId === null) {
    if (entry.moduleKind === 'custom') throw customModuleNotFound('')
    return null
  }
  const definition = await deps.customModules.findById(entry.customModuleId)
  if (definition === null) throw customModuleNotFound(entry.customModuleId)
  return definition
}

/**
 * An agent write must name the run it came from; a user write carries none.
 *
 * @throws DomainError `invalidFieldValue` when an agent write has no run.
 */
export function resolveSourceRunId(
  origin: ChangeOrigin,
  sourceRunId: AgentRunId | null | undefined,
  entity: string,
  id: string,
): AgentRunId | null {
  if (origin === 'agent') {
    if (sourceRunId === undefined || sourceRunId === null) {
      throw new DomainError(
        'invalidFieldValue',
        'An agent write must name the run it came from.',
        { entity, id, blockers: ['sourceRunId'] },
      )
    }
    return sourceRunId
  }
  return null
}

export interface NewChangeRecord {
  readonly entity: 'infoEntry' | 'customModule'
  readonly entityId: string
  readonly op: ChangeOp
  readonly beforeJson: string | null
  readonly afterJson: string | null
  readonly origin: ChangeOrigin
  readonly runId: AgentRunId | null
  readonly conversationId: ConversationId | null
  readonly label: string
}

/** Builds the record with the injected clock and identifier source. */
export function buildChangeRecord(
  deps: Pick<InfoLibraryDeps, 'ids' | 'clock'>,
  input: NewChangeRecord,
): ChangeRecord {
  return {
    id: asChangeRecordId(deps.ids.next()),
    scope: 'library',
    entity: input.entity,
    entityId: input.entityId,
    op: input.op,
    beforeJson: input.beforeJson,
    afterJson: input.afterJson,
    origin: input.origin,
    runId: input.runId,
    conversationId: input.conversationId,
    label: input.label,
    undoneAt: null,
    createdAt: deps.clock.now(),
  }
}

/** One past the highest stored order; a module with no entries starts at 1. */
export function nextSortOrder(entries: readonly InfoEntry[]): number {
  let highest = 0
  for (const entry of entries) highest = Math.max(highest, entry.sortOrder)
  return highest + 1
}
