/**
 * @file CustomModule
 * @description A user-defined information module: its name, the fields the user
 * declared, and the order it takes among the other custom modules. Entries of a
 * custom module are ordinary `InfoEntry` values that carry the module id, so the
 * definition never stores entry data.
 *
 * Responsibilities:
 * - Declare the bounds of a module name and of each field definition
 * - Allocate immutable field keys in the format the storage contract fixes
 * - Validate a definition before it is written or after it is read back
 *
 * Constraints:
 * - Field keys are immutable once created: stored entry values are keyed by
 *   them, so renaming a field may only change its label.
 * - This module is pure: no DOM, no storage, no package.
 * - Rules that need the other modules (the library-wide count and the
 *   case-insensitive uniqueness of names) are enforced by the use cases, which
 *   read the current collection; this module owns only the rules of one value.
 */

import { DomainError } from '../shared/DomainError'
import type { CustomFieldKey, CustomModuleId } from '../shared/branded-id'
import type { DateTime } from '../shared/DateTime'
import type { IdGenerator } from '../shared/IdGenerator'
import { countCodePoints } from './codePoints'

export const CUSTOM_FIELD_TYPES = ['text', 'textarea'] as const

/** Type of a user-declared field. Both hold text; only the form differs. */
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

/** Maximum number of custom modules in the library. */
export const CUSTOM_MODULE_LIMIT = 20

export const CUSTOM_MODULE_NAME_MAX_LENGTH = 20

export const CUSTOM_FIELD_COUNT_MIN = 1
export const CUSTOM_FIELD_COUNT_MAX = 12

export const CUSTOM_FIELD_LABEL_MAX_LENGTH = 20

export const CUSTOM_FIELD_TEXT_MAX_LENGTH = 200
export const CUSTOM_FIELD_TEXTAREA_MAX_LENGTH = 2000

/**
 * Key of the built-in title field every custom module entry has. It is not part
 * of `fields`, and a declared field may not reuse the key.
 */
export const CUSTOM_MODULE_TITLE_FIELD_KEY = 'title'

/**
 * Field key format: `f_` plus eight lowercase hexadecimal characters. Keys are
 * generated from opaque identifiers, so the format stays fixed even though the
 * identifier source may produce any text.
 */
const CUSTOM_FIELD_KEY_PATTERN = /^f_[0-9a-f]{8}$/

const CUSTOM_FIELD_KEY_SEED_BITS = 0x811c9dc5
const CUSTOM_FIELD_KEY_SEED_MULTIPLIER = 0x01000193

export interface CustomFieldDefinition {
  readonly key: CustomFieldKey
  /** Display label, 1..20 code points. */
  readonly label: string
  readonly type: CustomFieldType
  readonly required: boolean
  /** Maximum accepted length; `text` 1..200, `textarea` 1..2000. */
  readonly maxLength: number
}

export interface CustomModuleDefinition {
  readonly id: CustomModuleId
  /** Display name, 1..20 code points and unique across the library (case-insensitive). */
  readonly name: string
  /** At least one field, at most twelve; the array order is the form order. */
  readonly fields: readonly CustomFieldDefinition[]
  readonly sortOrder: number
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return value === 'text' || value === 'textarea'
}

/** True when `key` has the stored field-key format. */
export function isCustomFieldKey(key: string): boolean {
  return CUSTOM_FIELD_KEY_PATTERN.test(key)
}

/** Maximum length a field of this type may declare. */
export function maxLengthForFieldType(type: CustomFieldType): number {
  return type === 'text' ? CUSTOM_FIELD_TEXT_MAX_LENGTH : CUSTOM_FIELD_TEXTAREA_MAX_LENGTH
}

function customModuleError(
  code: 'blankRequiredField' | 'fieldTooLong' | 'duplicateFieldKey' | 'customFieldLimit' | 'invalidFieldValue',
  message: string,
  id: string,
  blockers: readonly string[] = [],
): DomainError {
  return new DomainError(code, message, { entity: 'customModule', id, blockers })
}

/**
 * Trims and validates a module name. The returned value is what gets stored, so
 * callers never persist surrounding whitespace.
 */
export function normalizeCustomModuleName(raw: string): string {
  const name = raw.trim()
  if (name === '') {
    throw customModuleError('blankRequiredField', 'A custom module needs a name.', 'name')
  }
  if (countCodePoints(name) > CUSTOM_MODULE_NAME_MAX_LENGTH) {
    throw customModuleError(
      'fieldTooLong',
      `A custom module name may be at most ${CUSTOM_MODULE_NAME_MAX_LENGTH.toString()} characters.`,
      'name',
    )
  }
  return name
}

/**
 * Derives the immutable key of a new field from the next opaque identifier.
 *
 * The hash is what keeps the key format independent of the identifier source:
 * production ids are UUIDs, the preview and the tests use readable counters, and
 * neither shape may leak into the stored key format.
 */
export function nextCustomFieldKey(ids: IdGenerator): CustomFieldKey {
  let hash = CUSTOM_FIELD_KEY_SEED_BITS
  for (const unit of ids.next()) {
    hash = Math.imul(hash ^ (unit.codePointAt(0) ?? 0), CUSTOM_FIELD_KEY_SEED_MULTIPLIER) >>> 0
  }
  return `f_${hash.toString(16).padStart(8, '0')}` as CustomFieldKey
}

function validateFieldLabel(label: string, key: string): void {
  if (label.trim() === '') {
    throw customModuleError('blankRequiredField', 'A custom field needs a label.', key)
  }
  if (countCodePoints(label.trim()) > CUSTOM_FIELD_LABEL_MAX_LENGTH) {
    throw customModuleError(
      'fieldTooLong',
      `A custom field label may be at most ${CUSTOM_FIELD_LABEL_MAX_LENGTH.toString()} characters.`,
      key,
    )
  }
}

function validateFieldMaxLength(field: CustomFieldDefinition): void {
  const maximum = maxLengthForFieldType(field.type)
  if (!Number.isInteger(field.maxLength) || field.maxLength < 1) {
    throw customModuleError(
      'invalidFieldValue',
      `The maximum length of field "${field.key}" must be a positive integer.`,
      field.key,
    )
  }
  if (field.maxLength > maximum) {
    throw customModuleError(
      'fieldTooLong',
      `The maximum length of a ${field.type} field is ${maximum.toString()} characters.`,
      field.key,
    )
  }
}

/**
 * Validates one declared field. Used for new fields before they are appended and
 * when a definition is read back from storage.
 */
export function validateCustomFieldDefinition(field: CustomFieldDefinition): void {
  // The built-in key is checked before the format so the refusal names the real
  // conflict (a duplicate key) rather than reporting an unformatted key.
  if (field.key === CUSTOM_MODULE_TITLE_FIELD_KEY) {
    throw customModuleError(
      'duplicateFieldKey',
      'The title field is built in and cannot be declared again.',
      field.key,
    )
  }
  if (!isCustomFieldKey(field.key)) {
    throw customModuleError(
      'invalidFieldValue',
      `"${field.key}" is not a valid custom field key.`,
      field.key,
    )
  }
  if (!isCustomFieldType(field.type)) {
    throw customModuleError(
      'invalidFieldValue',
      `"${String(field.type)}" is not a field type this build stores.`,
      field.key,
    )
  }
  validateFieldLabel(field.label, field.key)
  validateFieldMaxLength(field)
}

/**
 * Validates the parts of a definition that do not depend on the rest of the
 * library: the name, the field count, the uniqueness and shape of the keys and
 * each field's own bounds.
 */
export function validateCustomModuleDefinition(module: CustomModuleDefinition): void {
  normalizeCustomModuleName(module.name)
  if (module.fields.length < CUSTOM_FIELD_COUNT_MIN) {
    throw customModuleError(
      'blankRequiredField',
      'A custom module needs at least one field.',
      module.id,
      [module.id],
    )
  }
  if (module.fields.length > CUSTOM_FIELD_COUNT_MAX) {
    throw customModuleError(
      'customFieldLimit',
      `A custom module may declare at most ${CUSTOM_FIELD_COUNT_MAX.toString()} fields.`,
      module.id,
      [module.id],
    )
  }
  const seen = new Set<string>()
  for (const field of module.fields) {
    validateCustomFieldDefinition(field)
    if (seen.has(field.key)) {
      throw customModuleError(
        'duplicateFieldKey',
        `Field key "${field.key}" is declared twice.`,
        field.key,
        [field.key],
      )
    }
    seen.add(field.key)
  }
  if (!Number.isInteger(module.sortOrder) || module.sortOrder < 1) {
    throw customModuleError(
      'invalidFieldValue',
      'A custom module needs a positive integer sort order.',
      module.id,
    )
  }
}
