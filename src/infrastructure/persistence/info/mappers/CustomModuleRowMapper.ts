/**
 * @file CustomModuleRowMapper
 * @description Row mapping for custom module definitions. The field list lives
 * in one JSON envelope; the columns around it carry identity, order and
 * timestamps.
 *
 * Constraints:
 * - A definition read back is validated against the same rules a new one goes
 *   through (key format, field count, labels, declared maxima), so a stored
 *   definition that predates a rule is reported rather than used.
 * - The mapper never renumbers or repairs fields: the array order is the form
 *   order the user chose.
 */

import { isDomainError } from '../../../../domain/shared/DomainError'
import {
  asCustomFieldKey,
  asCustomModuleId,
} from '../../../../domain/shared/branded-id'
import type { CustomFieldDefinition, CustomModuleDefinition } from '../../../../domain/info/CustomModule'
import {
  isCustomFieldType,
  validateCustomModuleDefinition,
} from '../../../../domain/info/CustomModule'
import { RowMappingError, writeJsonEnvelope } from '../../JsonEnvelope'
import type { SqlValue } from '../../sqlite'
import type { Row } from './rowContract'
import { envelopeArray, requiredDateTime, requiredInteger, requiredString } from './rowContract'

export const CUSTOM_MODULE_COLUMNS = 'id, name, fields_json, sort_order, created_at, updated_at'

/** The `fields_json` payload of a definition: the declared fields in form order. */
export function customModuleFieldsEnvelope(module: CustomModuleDefinition): string {
  return writeJsonEnvelope(
    module.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      maxLength: field.maxLength,
    })),
  )
}

/** Values in the order of `CUSTOM_MODULE_COLUMNS`. */
export function customModuleRowValues(module: CustomModuleDefinition): readonly SqlValue[] {
  return [
    module.id,
    module.name,
    customModuleFieldsEnvelope(module),
    module.sortOrder,
    module.createdAt,
    module.updatedAt,
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fieldColumn(index: number, property: string): string {
  return `custom_module.fields_json[${index.toString()}].${property}`
}

function mapField(raw: unknown, index: number): CustomFieldDefinition {
  if (!isRecord(raw)) {
    throw new RowMappingError(
      `custom_module.fields_json[${index.toString()}]`,
      'expected a field object',
      raw,
    )
  }
  const key = raw.key
  if (typeof key !== 'string') {
    throw new RowMappingError(fieldColumn(index, 'key'), 'expected text', key)
  }
  const label = raw.label
  if (typeof label !== 'string') {
    throw new RowMappingError(fieldColumn(index, 'label'), 'expected text', label)
  }
  const type = raw.type
  if (!isCustomFieldType(type)) {
    throw new RowMappingError(fieldColumn(index, 'type'), 'expected a stored field type', type)
  }
  const required = raw.required
  if (typeof required !== 'boolean') {
    throw new RowMappingError(fieldColumn(index, 'required'), 'expected true or false', required)
  }
  const maxLength = raw.maxLength
  if (typeof maxLength !== 'number' || !Number.isInteger(maxLength)) {
    throw new RowMappingError(fieldColumn(index, 'maxLength'), 'expected an integer', maxLength)
  }
  return {
    key: asCustomFieldKey(key),
    label,
    type,
    required,
    maxLength,
  }
}

/** Maps one custom_module row and validates the definition it rebuilds. */
export function mapCustomModuleRow(row: Row): CustomModuleDefinition {
  const module: CustomModuleDefinition = {
    id: asCustomModuleId(requiredString(row, 'id')),
    name: requiredString(row, 'name'),
    fields: envelopeArray(row.fields_json, 'custom_module.fields_json').map(mapField),
    sortOrder: requiredInteger(row, 'sort_order'),
    createdAt: requiredDateTime(row, 'created_at'),
    updatedAt: requiredDateTime(row, 'updated_at'),
  }
  try {
    validateCustomModuleDefinition(module)
  } catch (error) {
    if (isDomainError(error)) {
      throw new RowMappingError(
        'custom_module',
        `stored definition violates the module contract: ${error.message}`,
        row.fields_json,
        { cause: error },
      )
    }
    throw error
  }
  return module
}
