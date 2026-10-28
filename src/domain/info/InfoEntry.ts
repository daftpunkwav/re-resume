/**
 * @file InfoEntry
 * @description One record of the information library: the module it belongs to,
 * its field values, the derived title and the position it takes inside its
 * module. Entries are the shared facts a resume selects from; a resume holds
 * their identifiers rather than copies.
 *
 * Responsibilities:
 * - Declare the entry value and its origin marker
 * - Derive the title the interface and the resume show
 * - Provide the runtime guard the row mapper needs for the origin column
 *
 * Constraints:
 * - `moduleKind === 'custom'` if and only if `customModuleId !== null`.
 * - The title is derived and persisted; it is recomputed on every write and
 *   never accepted from input.
 * - This module is pure: no DOM, no storage, no package.
 */

import type { AgentRunId, CustomModuleId, InfoEntryId } from '../shared/branded-id'
import type { DateTime } from '../shared/DateTime'
import type { CustomModuleDefinition } from './CustomModule'
import { countCodePoints } from './codePoints'
import { MODULE_FIELDS } from './InfoFieldValue'
import type { InfoFieldValue } from './InfoFieldValue'
import type { InfoModuleKind } from './InfoModuleKind'

export const INFO_ORIGINS = ['user', 'agent'] as const

/** Who wrote the entry; an agent write also carries the run it came from. */
export type InfoOrigin = (typeof INFO_ORIGINS)[number]

export interface InfoEntry {
  readonly id: InfoEntryId
  readonly moduleKind: InfoModuleKind
  /** Only a custom entry names a module; built-in modules leave it null. */
  readonly customModuleId: CustomModuleId | null
  /** Derived from the fields and stored alongside them. */
  readonly title: string
  readonly fields: Readonly<Record<string, InfoFieldValue>>
  /** 1..n position inside the module; not necessarily dense after deletions. */
  readonly sortOrder: number
  readonly origin: InfoOrigin
  /** Non-null exactly when the origin is 'agent'. */
  readonly sourceRunId: AgentRunId | null
  readonly createdAt: DateTime
  readonly updatedAt: DateTime
}

/** Shown when a value that titles the entry is missing. */
export const UNTITLED_ENTRY = '未命名'

/** Code points of a self-evaluation statement kept in its derived title. */
const SELF_EVALUATION_TITLE_LENGTH = 24

export function isInfoOrigin(value: unknown): value is InfoOrigin {
  return value === 'user' || value === 'agent'
}

function textField(fields: Readonly<Record<string, InfoFieldValue>>, key: string): string {
  const value = fields[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** Label of a degree value, read from the field table so there is one copy of the text. */
function degreeLabel(value: string): string {
  const descriptor = MODULE_FIELDS.education.find((field) => field.key === 'degree')
  return descriptor?.options?.find((option) => option.value === value)?.label ?? ''
}

/** `a · b` with absent parts dropped, so a missing optional value never leaves a separator. */
function joined(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(' · ')
}

/**
 * Derives the title an entry is listed under. A missing source value yields
 * `未命名` rather than an empty title, so a half-filled entry stays reachable in
 * the interface and in search results.
 */
export function deriveEntryTitle(
  moduleKind: InfoModuleKind,
  _custom: CustomModuleDefinition | null,
  fields: Readonly<Record<string, InfoFieldValue>>,
): string {
  switch (moduleKind) {
    case 'personal':
      return textField(fields, 'fullName') || UNTITLED_ENTRY
    case 'education': {
      const school = textField(fields, 'school')
      if (school === '') return UNTITLED_ENTRY
      const degree = degreeLabel(textField(fields, 'degree'))
      return degree === '' ? school : `${school}（${degree}）`
    }
    case 'internship': {
      const title = joined([textField(fields, 'company'), textField(fields, 'role')])
      return title === '' ? UNTITLED_ENTRY : title
    }
    case 'project':
    case 'skill':
    case 'award':
      return textField(fields, 'name') || UNTITLED_ENTRY
    case 'jobIntent':
      return textField(fields, 'targetRole') || UNTITLED_ENTRY
    case 'selfEvaluation': {
      const content = textField(fields, 'content')
      if (content === '') return UNTITLED_ENTRY
      return countCodePoints(content) <= SELF_EVALUATION_TITLE_LENGTH
        ? content
        : [...content].slice(0, SELF_EVALUATION_TITLE_LENGTH).join('')
    }
    case 'custom':
      return textField(fields, 'title') || UNTITLED_ENTRY
    default:
      return UNTITLED_ENTRY
  }
}
