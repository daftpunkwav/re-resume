/**
 * @file formatInfoValues
 * @description Display readers for stored field values: the label of an
 * enumerated value, a formatted start/end range and the one-line summary an
 * entry row shows under its title.
 *
 * Responsibilities:
 * - Read labels from the field table instead of keeping a second copy
 * - Format month-precision dates through the domain formatter
 * - Compose a short summary per module for the entry list
 *
 * Constraints:
 * - Pure and presentation-only: no service access, no state.
 * - A value that is absent or unreadable is dropped from a summary rather than
 *   rendered as an empty separator.
 */

import type { CustomModuleDefinition } from '../../../domain/info/CustomModule'
import type { FieldDescriptor, InfoFieldValue } from '../../../domain/info/InfoFieldValue'
import { fieldDescriptors } from '../../../domain/info/InfoFieldValue'
import type { InfoModuleKind } from '../../../domain/info/InfoModuleKind'
import { MODULE_DESCRIPTORS } from '../../../domain/info/InfoModuleKind'
import { formatKnowledgeDate, parseKnowledgeDate } from '../../../domain/shared/KnowledgeDate'

/** The stored text of a field, or the empty string when it is not text. */
function textValue(
  fields: Readonly<Record<string, InfoFieldValue>>,
  key: string,
): string {
  const value = fields[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** The display label of an enumerated value, or the raw value as a fallback. */
function optionLabel(descriptor: FieldDescriptor, value: string): string {
  const option = descriptor.options?.find((candidate) => candidate.value === value)
  return option?.label ?? value
}

/** The label of the descriptor's selected option; empty when nothing is chosen. */
function selectedOptionLabel(
  descriptors: readonly FieldDescriptor[],
  key: string,
  fields: Readonly<Record<string, InfoFieldValue>>,
): string {
  const descriptor = descriptors.find((candidate) => candidate.key === key)
  const value = textValue(fields, key)
  if (descriptor === undefined || value === '') return ''
  return optionLabel(descriptor, value)
}

/** A start/end range as `2021 年 9 月 – 至今`; either side may be absent. */
function formatDateRange(
  fields: Readonly<Record<string, InfoFieldValue>>,
): string {
  const start = textValue(fields, 'startDate')
  const end = textValue(fields, 'endDate')
  const parts: string[] = []
  const parsedStart = parseKnowledgeDate(start)
  if (parsedStart !== null) parts.push(formatKnowledgeDate(parsedStart))
  const parsedEnd = parseKnowledgeDate(end)
  if (parsedEnd !== null) parts.push(formatKnowledgeDate(parsedEnd))
  return parts.join(' – ')
}

function joinParts(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(' · ')
}

/**
 * The quiet second line of an entry row: what distinguishes this entry from
 * another with a similar title. A module with nothing worth adding returns the
 * empty string and the row renders no second line.
 */
export function entrySubtitle(
  moduleKind: InfoModuleKind,
  fields: Readonly<Record<string, InfoFieldValue>>,
  customModule: CustomModuleDefinition | null,
): string {
  const descriptors = fieldDescriptors(moduleKind, customModule)
  switch (moduleKind) {
    case 'personal':
      return joinParts([textValue(fields, 'city'), textValue(fields, 'email')])
    case 'education':
      return joinParts([selectedOptionLabel(descriptors, 'degree', fields), formatDateRange(fields)])
    case 'internship':
      return joinParts([formatDateRange(fields), textValue(fields, 'location')])
    case 'project':
      return joinParts([textValue(fields, 'role'), formatDateRange(fields)])
    case 'skill':
      return joinParts([
        textValue(fields, 'category'),
        selectedOptionLabel(descriptors, 'level', fields),
      ])
    case 'award':
      return joinParts([
        selectedOptionLabel(descriptors, 'level', fields),
        formatSingleDate(fields, 'date'),
      ])
    case 'jobIntent':
      return joinParts([
        textValue(fields, 'city'),
        selectedOptionLabel(descriptors, 'employmentType', fields),
      ])
    case 'selfEvaluation':
      return ''
    case 'custom': {
      const firstValue = descriptors
        .filter((descriptor) => descriptor.key !== 'title')
        .map((descriptor) => textValue(fields, descriptor.key))
        .find((value) => value !== '')
      return firstValue ?? ''
    }
  }
}

/** A single month-precision date field, formatted; empty when absent or invalid. */
function formatSingleDate(
  fields: Readonly<Record<string, InfoFieldValue>>,
  key: string,
): string {
  const parsed = parseKnowledgeDate(textValue(fields, key))
  return parsed === null ? '' : formatKnowledgeDate(parsed)
}

/** The label of a module selection, including a custom module's own name. */
export function moduleSelectionLabel(
  moduleKind: InfoModuleKind,
  customModule: CustomModuleDefinition | null,
): string {
  if (moduleKind !== 'custom') return MODULE_DESCRIPTORS[moduleKind].label
  return customModule?.name ?? MODULE_DESCRIPTORS.custom.label
}
