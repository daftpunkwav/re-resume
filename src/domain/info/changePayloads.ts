/**
 * @file changePayloads
 * @description The JSON payloads a library change record stores beside its op:
 * an entry, a module definition, the order mappings of a reorder, the cleared
 * field values of a module update, and the bundle a module deletion records.
 * Writing and reading live in one pair so they cannot drift: a field added to a
 * domain type flows through the serializer, and the parser refuses a payload
 * whose keys it does not know instead of silently rebuilding the value without
 * it — which is how an undo would otherwise drop data.
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - A parse problem throws `PayloadParseError` naming the offending key; the
 *   undo seam wraps that into its own diagnosable refusal.
 * - The serialized shape is exactly the domain value's own shape, so the write
 *   side is a plain stringify and the parser is the contract.
 */

import { asAgentRunId, asCustomFieldKey, asCustomModuleId, asInfoEntryId } from '../shared/branded-id'
import type { CustomFieldKey, InfoEntryId } from '../shared/branded-id'
import { parseDateTime } from '../shared/DateTime'
import type { DateTime } from '../shared/DateTime'
import type { CustomFieldDefinition, CustomModuleDefinition } from './CustomModule'
import { isCustomFieldType, validateCustomModuleDefinition } from './CustomModule'
import type { InfoEntry } from './InfoEntry'
import { isInfoOrigin } from './InfoEntry'
import type { InfoFieldValue } from './InfoFieldValue'
import { isInfoModuleKind } from './InfoModuleKind'

/** A payload this build wrote cannot be read back under the current contract. */
export class PayloadParseError extends Error {}

const ENTRY_KEYS = [
  'id',
  'moduleKind',
  'customModuleId',
  'title',
  'fields',
  'sortOrder',
  'origin',
  'sourceRunId',
  'createdAt',
  'updatedAt',
] as const

const MODULE_KEYS = ['id', 'name', 'fields', 'sortOrder', 'createdAt', 'updatedAt'] as const

const FIELD_KEYS = ['key', 'label', 'type', 'required', 'maxLength'] as const

const ORDER_KEYS = ['id', 'sortOrder'] as const

const CLEARED_KEYS = ['entryId', 'fieldKey', 'value'] as const

const DELETED_MODULE_KEYS = ['module', 'entries'] as const

const UPDATED_MODULE_KEYS = ['module', 'clearedValues'] as const

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Refuses a payload that carries keys the contract does not know. */
function requireKnownKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  const known = new Set<string>(keys)
  const extra = Object.keys(record).filter((key) => !known.has(key))
  if (extra.length > 0) {
    throw new PayloadParseError(`payload carries unknown keys: ${extra.join(', ')}`)
  }
}

function requireString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') {
    throw new PayloadParseError(`payload key ${key} must be a non-empty string`)
  }
  return value
}

function optionalString(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = record[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new PayloadParseError(`payload key ${key} must be a string`)
  return value
}

function requireTimestamp(record: Readonly<Record<string, unknown>>, key: string): DateTime {
  const parsed = parseDateTime(requireString(record, key))
  if (parsed === null) {
    throw new PayloadParseError(`payload key ${key} must be an ISO timestamp`)
  }
  return parsed
}

function requireSortOrder(record: Readonly<Record<string, unknown>>): number {
  const value = record.sortOrder
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new PayloadParseError('payload key sortOrder must be a positive integer')
  }
  return value
}

function requireFieldValues(
  value: unknown,
): Readonly<Record<string, InfoFieldValue>> {
  if (!isRecord(value)) throw new PayloadParseError('payload key fields must be an object')
  const fields: Record<string, InfoFieldValue> = {}
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue !== 'string' && typeof fieldValue !== 'boolean' && fieldValue !== null) {
      throw new PayloadParseError(`payload key fields.${key} must be a string, a boolean or null`)
    }
    fields[key] = fieldValue
  }
  return fields
}

/** Serializes the entry an entry create, update or delete records. */
export function serializeInfoEntryPayload(entry: InfoEntry): string {
  return JSON.stringify(entry)
}

/** Reads one entry payload back, refusing unknown keys. */
export function parseInfoEntryPayload(value: unknown): InfoEntry {
  if (!isRecord(value)) throw new PayloadParseError('payload must be an object')
  requireKnownKeys(value, ENTRY_KEYS)
  const moduleKind = value.moduleKind
  if (!isInfoModuleKind(moduleKind)) {
    throw new PayloadParseError('payload key moduleKind is not a module kind')
  }
  const customModuleId = optionalString(value, 'customModuleId')
  if ((moduleKind === 'custom') !== (customModuleId !== null)) {
    throw new PayloadParseError('customModuleId must be set exactly for the custom module kind')
  }
  const origin = value.origin
  if (!isInfoOrigin(origin)) {
    throw new PayloadParseError('payload key origin is not an entry origin')
  }
  const sourceRunId = optionalString(value, 'sourceRunId')
  return {
    id: asInfoEntryId(requireString(value, 'id')),
    moduleKind,
    customModuleId: customModuleId === null ? null : asCustomModuleId(customModuleId),
    title: requireString(value, 'title'),
    fields: requireFieldValues(value.fields),
    sortOrder: requireSortOrder(value),
    origin,
    sourceRunId: sourceRunId === null ? null : asAgentRunId(sourceRunId),
    createdAt: requireTimestamp(value, 'createdAt'),
    updatedAt: requireTimestamp(value, 'updatedAt'),
  }
}

/** Serializes the module definition a module create or update records. */
export function serializeCustomModulePayload(module: CustomModuleDefinition): string {
  return JSON.stringify(module)
}

/** Reads one module definition payload back, refusing unknown keys. */
export function parseCustomModulePayload(value: unknown): CustomModuleDefinition {
  if (!isRecord(value)) throw new PayloadParseError('payload must be an object')
  requireKnownKeys(value, MODULE_KEYS)
  const rawFields = value.fields
  if (!Array.isArray(rawFields)) {
    throw new PayloadParseError('payload key fields must be an array')
  }
  const fields: CustomFieldDefinition[] = rawFields.map((rawField) => {
    if (!isRecord(rawField)) throw new PayloadParseError('a declared field must be an object')
    requireKnownKeys(rawField, FIELD_KEYS)
    const type = rawField.type
    if (!isCustomFieldType(type)) {
      throw new PayloadParseError('a declared field carries an unknown type')
    }
    if (typeof rawField.required !== 'boolean') {
      throw new PayloadParseError('payload key required must be a boolean')
    }
    const maxLength = rawField.maxLength
    if (typeof maxLength !== 'number') {
      throw new PayloadParseError('payload key maxLength must be a number')
    }
    return {
      key: asCustomFieldKey(requireString(rawField, 'key')),
      label: requireString(rawField, 'label'),
      type,
      required: rawField.required,
      maxLength,
    }
  })
  const module: CustomModuleDefinition = {
    id: asCustomModuleId(requireString(value, 'id')),
    name: requireString(value, 'name'),
    fields,
    sortOrder: requireSortOrder(value),
    createdAt: requireTimestamp(value, 'createdAt'),
    updatedAt: requireTimestamp(value, 'updatedAt'),
  }
  // The domain's own validation is part of reading the payload back: its
  // DomainError is an English rule refusal, so it is re-thrown as the payload
  // error the undo seam knows how to describe.
  try {
    validateCustomModuleDefinition(module)
  } catch (failure) {
    throw new PayloadParseError(
      `payload module does not validate: ${failure instanceof Error ? failure.message : String(failure)}`,
    )
  }
  return module
}

/** One custom field value the module update cleared and the inverse writes back. */
export interface ClearedFieldValuePayload {
  readonly entryId: InfoEntryId
  readonly fieldKey: CustomFieldKey
  readonly value: InfoFieldValue
}

/** Serializes the before side of a module update: the definition and the cleared values. */
export function serializeModuleUpdatePayload(
  module: CustomModuleDefinition,
  clearedValues: readonly ClearedFieldValuePayload[],
): string {
  return JSON.stringify({ module, clearedValues })
}

/** Reads the before side of a module update back, refusing unknown keys. */
export function parseModuleUpdatePayload(value: unknown): {
  readonly module: CustomModuleDefinition
  readonly clearedValues: readonly ClearedFieldValuePayload[]
} {
  if (!isRecord(value)) throw new PayloadParseError('payload must be an object')
  requireKnownKeys(value, UPDATED_MODULE_KEYS)
  return {
    module: parseCustomModulePayload(value.module),
    clearedValues: parseClearedValues(value.clearedValues),
  }
}

function parseClearedValues(value: unknown): readonly ClearedFieldValuePayload[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new PayloadParseError('payload key clearedValues must be an array')
  }
  return value.map((cleared) => {
    if (!isRecord(cleared)) throw new PayloadParseError('a cleared value must be an object')
    requireKnownKeys(cleared, CLEARED_KEYS)
    const fieldValue = cleared.value
    if (typeof fieldValue !== 'string' && typeof fieldValue !== 'boolean' && fieldValue !== null) {
      throw new PayloadParseError('a cleared value must be a string, a boolean or null')
    }
    return {
      entryId: asInfoEntryId(requireString(cleared, 'entryId')),
      fieldKey: asCustomFieldKey(requireString(cleared, 'fieldKey')),
      value: fieldValue,
    }
  })
}

/** Serializes the bundle a module deletion records: the definition and its entries. */
export function serializeDeletedModulePayload(
  module: CustomModuleDefinition,
  entries: readonly InfoEntry[],
): string {
  return JSON.stringify({ module, entries })
}

/** Reads a module deletion bundle back, refusing unknown keys. */
export function parseDeletedModulePayload(value: unknown): {
  readonly module: CustomModuleDefinition
  readonly entries: readonly InfoEntry[]
} {
  if (!isRecord(value)) throw new PayloadParseError('payload must be an object')
  requireKnownKeys(value, DELETED_MODULE_KEYS)
  if (!Array.isArray(value.entries)) {
    throw new PayloadParseError('payload key entries must be an array')
  }
  return {
    module: parseCustomModulePayload(value.module),
    entries: value.entries.map((entry) => parseInfoEntryPayload(entry)),
  }
}

/** The id/position pair a reorder records. */
export interface OrderMappingPayload {
  readonly id: string
  readonly sortOrder: number
}

/** Serializes the order mappings a reorder records. */
export function serializeOrderMappings(mappings: readonly OrderMappingPayload[]): string {
  return JSON.stringify(mappings)
}

/** Reads the order mappings a reorder records, refusing unknown keys. */
export function parseOrderMappings(value: unknown): readonly OrderMappingPayload[] {
  if (!Array.isArray(value)) {
    throw new PayloadParseError('an order payload must be an array')
  }
  return value.map((entry) => {
    if (!isRecord(entry)) throw new PayloadParseError('an order mapping must be an object')
    requireKnownKeys(entry, ORDER_KEYS)
    return { id: requireString(entry, 'id'), sortOrder: requireSortOrder(entry) }
  })
}
