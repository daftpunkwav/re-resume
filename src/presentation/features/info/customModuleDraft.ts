/**
 * @file customModuleDraft
 * @description The draft values and local checks of the custom-module authoring
 * form. They are not the domain rules: they exist so a visible mistake is
 * pointed out before a round trip, while the use cases still decide what is
 * stored.
 *
 * Responsibilities:
 * - Describe one field row as the form edits it
 * - Build a full draft from a stored definition
 * - Check the name and field bounds the user can see
 *
 * Constraints:
 * - Bounds come from the domain's exported constants, not from repeated
 *   literals.
 * - Code-point counting is the domain's, so the counter and the validator
 *   agree on what a character is.
 */

import type {
  CustomFieldKey,
  CustomModuleId,
} from '../../../domain/shared/branded-id'
import type {
  CustomFieldType,
  CustomModuleDefinition,
} from '../../../domain/info/CustomModule'
import {
  CUSTOM_FIELD_LABEL_MAX_LENGTH,
  CUSTOM_MODULE_NAME_MAX_LENGTH,
  maxLengthForFieldType,
  normalizeCustomModuleName,
} from '../../../domain/info/CustomModule'
import { countCodePoints } from '../../../domain/info/codePoints'

/** One field row of the form; `key` is null until the field is stored. */
export interface CustomModuleFieldDraft {
  readonly key: CustomFieldKey | null
  readonly label: string
  readonly type: CustomFieldType
  readonly required: boolean
  readonly maxLength: number
}

export interface CustomModuleFieldError {
  readonly label?: string
  readonly maxLength?: string
}

/** The form's working copy of a module definition. */
export function draftFieldsOf(
  module: CustomModuleDefinition | null,
): readonly CustomModuleFieldDraft[] {
  if (module === null) {
    return [{ key: null, label: '', type: 'text', required: false, maxLength: 200 }]
  }
  return module.fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    maxLength: field.maxLength,
  }))
}

/** A fresh row, used by the add-field action. */
export function newFieldDraft(): CustomModuleFieldDraft {
  return { key: null, label: '', type: 'text', required: false, maxLength: 200 }
}

/** Per-row errors; an empty record means every visible field is acceptable. */
export function validateFieldDrafts(
  fields: readonly CustomModuleFieldDraft[],
): Readonly<Record<number, CustomModuleFieldError>> {
  const errors: Record<number, CustomModuleFieldError> = {}
  fields.forEach((field, index) => {
    const label = field.label.trim()
    const labelError =
      label === ''
        ? '请填写字段名称。'
        : countCodePoints(label) > CUSTOM_FIELD_LABEL_MAX_LENGTH
          ? `最多 ${String(CUSTOM_FIELD_LABEL_MAX_LENGTH)} 个字符。`
          : undefined
    const maximum = maxLengthForFieldType(field.type)
    const maxLengthError =
      !Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > maximum
        ? `请填写 1 到 ${maximum.toString()} 之间的整数。`
        : undefined
    if (labelError !== undefined || maxLengthError !== undefined) {
      errors[index] = { label: labelError, maxLength: maxLengthError }
    }
  })
  return errors
}

interface NormalizedName {
  readonly name?: string
  readonly error?: string
}

/**
 * Reads the module name the way the domain would. The form shows the refusal
 * inline, which is the only reason this is a result value instead of a throw.
 */
export function readModuleName(raw: string): NormalizedName {
  try {
    return { name: normalizeCustomModuleName(raw) }
  } catch {
    return {
      error:
        raw.trim() === ''
          ? '请填写模块名称。'
          : `最多 ${String(CUSTOM_MODULE_NAME_MAX_LENGTH)} 个字符。`,
    }
  }
}

/** True when another module already uses the name (case-insensitive). */
export function nameTaken(
  name: string,
  modules: readonly CustomModuleDefinition[],
  exceptId: CustomModuleId | null,
): boolean {
  const normalized = name.toLowerCase()
  return modules.some(
    (module) => module.id !== exceptId && module.name.toLowerCase() === normalized,
  )
}
