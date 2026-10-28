/**
 * @file InfoEntryRowMapper
 * @description Row mapping for information entries. The field record lives in
 * one JSON envelope; the columns around it carry the module, the derived title,
 * the order and the provenance.
 *
 * Constraints:
 * - The field record is validated against the module schema on read as well as
 *   on write, so a row whose stored values violate the schema is reported
 *   instead of being handed to the interface as a half-valid entry.
 * - A custom entry cannot be mapped without its definition, because the
 *   definition declares which field keys are legal.
 */

import { isDomainError } from '../../../../domain/shared/DomainError'
import {
  asAgentRunId,
  asCustomModuleId,
  asInfoEntryId,
} from '../../../../domain/shared/branded-id'
import type { CustomModuleDefinition } from '../../../../domain/info/CustomModule'
import { isInfoOrigin } from '../../../../domain/info/InfoEntry'
import type { InfoEntry } from '../../../../domain/info/InfoEntry'
import { isInfoModuleKind } from '../../../../domain/info/InfoModuleKind'
import { validateFieldValues } from '../../../../domain/info/InfoFieldValue'
import type { InfoFieldValue } from '../../../../domain/info/InfoFieldValue'
import type { InfoModuleKind } from '../../../../domain/info/InfoModuleKind'
import { RowMappingError, writeJsonEnvelope } from '../../JsonEnvelope'
import type { SqlValue } from '../../sqlite'
import type { Row } from './rowContract'
import {
  envelopeRecord,
  optionalString,
  requiredDateTime,
  requiredInteger,
  requiredString,
} from './rowContract'

export const INFO_ENTRY_COLUMNS =
  'id, module_kind, custom_module_id, title, fields_json, sort_order, origin, ' +
  'source_run_id, created_at, updated_at'

/** Values in the order of `INFO_ENTRY_COLUMNS`. */
export function infoEntryRowValues(entry: InfoEntry): readonly SqlValue[] {
  return [
    entry.id,
    entry.moduleKind,
    entry.customModuleId,
    entry.title,
    writeJsonEnvelope(entry.fields),
    entry.sortOrder,
    entry.origin,
    entry.sourceRunId,
    entry.createdAt,
    entry.updatedAt,
  ]
}

function readFields(
  raw: unknown,
  moduleKind: InfoModuleKind,
  customModule: CustomModuleDefinition | null,
): Readonly<Record<string, InfoFieldValue>> {
  const payload = envelopeRecord(raw, 'info_entry.fields_json')
  try {
    return validateFieldValues(moduleKind, customModule, payload)
  } catch (error) {
    if (isDomainError(error)) {
      throw new RowMappingError(
        'info_entry.fields_json',
        `stored fields violate the module schema: ${error.message}`,
        raw,
        { cause: error },
      )
    }
    throw error
  }
}

/** Maps one info_entry row; a custom entry needs the definition that names its fields. */
export function mapInfoEntryRow(
  row: Row,
  customModule: CustomModuleDefinition | null,
): InfoEntry {
  const moduleKind = requiredString(row, 'module_kind')
  if (!isInfoModuleKind(moduleKind)) {
    throw new RowMappingError(
      'info_entry.module_kind',
      'is not a module kind this build knows',
      moduleKind,
    )
  }
  const customModuleIdText = optionalString(row, 'custom_module_id')
  const customModuleId = customModuleIdText === null ? null : asCustomModuleId(customModuleIdText)
  if ((moduleKind === 'custom') !== (customModuleId !== null)) {
    throw new RowMappingError(
      'info_entry.custom_module_id',
      'must be present exactly when the module kind is custom',
      customModuleIdText,
    )
  }
  if (moduleKind === 'custom' && customModule === null) {
    throw new RowMappingError(
      'info_entry.custom_module_id',
      'names a custom module whose definition is missing',
      customModuleIdText,
    )
  }
  const origin = requiredString(row, 'origin')
  if (!isInfoOrigin(origin)) {
    throw new RowMappingError('info_entry.origin', 'is not an origin this build knows', origin)
  }
  const sourceRunIdText = optionalString(row, 'source_run_id')
  if (origin === 'agent' && sourceRunIdText === null) {
    throw new RowMappingError(
      'info_entry.source_run_id',
      'must be present for an agent-written entry',
      sourceRunIdText,
    )
  }
  const sortOrder = requiredInteger(row, 'sort_order')
  if (sortOrder < 1) {
    throw new RowMappingError('info_entry.sort_order', 'must be at least 1', sortOrder)
  }
  return {
    id: asInfoEntryId(requiredString(row, 'id')),
    moduleKind,
    customModuleId,
    title: requiredString(row, 'title'),
    fields: readFields(row.fields_json, moduleKind, customModule),
    sortOrder,
    origin,
    sourceRunId: sourceRunIdText === null ? null : asAgentRunId(sourceRunIdText),
    createdAt: requiredDateTime(row, 'created_at'),
    updatedAt: requiredDateTime(row, 'updated_at'),
  }
}
