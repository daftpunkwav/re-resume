/**
 * @file InfoFieldValue
 * @description The field schema of the information library. Every module's fields
 * are declared once here — key, label, type, required flag, maximum length and
 * enumeration — and one validator applies the same rules for the interface, the
 * agent and the fixtures.
 *
 * Responsibilities:
 * - Declare the field table of the eight built-in modules
 * - Derive the field table of a custom module from its definition
 * - Validate a raw field record and return the canonical stored form
 *
 * Constraints:
 * - The validation order is part of the contract: unknown keys, then required
 *   values, then lengths, then per-type formats, then the start/end order. A
 *   caller that reports the first error gets the same code the contract names.
 * - Lengths count Unicode code points, not UTF-16 code units.
 * - This module is pure: no DOM, no storage, no package. Error codes come from
 *   the closed set in DomainError.
 */

import { DomainError } from '../shared/DomainError'
import {
  compareKnowledgeDate,
  parseKnowledgeDate,
  PRESENT,
} from '../shared/KnowledgeDate'
import type { CustomFieldDefinition, CustomModuleDefinition } from './CustomModule'
import { CUSTOM_MODULE_TITLE_FIELD_KEY } from './CustomModule'
import { countCodePoints } from './codePoints'
import { INFO_MODULE_KINDS } from './InfoModuleKind'
import type { InfoModuleKind } from './InfoModuleKind'

/** A stored field value: text, a flag, or nothing. */
export type InfoFieldValue = string | boolean | null

export type FieldType = 'text' | 'textarea' | 'date' | 'dateOrPresent' | 'enum' | 'bool' | 'url' | 'email'

export interface FieldOption {
  readonly value: string
  readonly label: string
}

export interface FieldDescriptor {
  readonly key: string
  readonly label: string
  readonly type: FieldType
  readonly required: boolean
  readonly maxLength: number | null
  readonly options?: readonly FieldOption[]
  readonly hint?: string
}

/** Title field every custom module entry carries, in addition to the declared fields. */
export const CUSTOM_TITLE_FIELD: FieldDescriptor = {
  key: CUSTOM_MODULE_TITLE_FIELD_KEY,
  label: '标题',
  type: 'text',
  required: true,
  maxLength: 80,
}

/** Personal details. */
const PERSONAL_FIELDS: readonly FieldDescriptor[] = [
  { key: 'fullName', label: '姓名', type: 'text', required: true, maxLength: 80 },
  {
    key: 'gender',
    label: '性别',
    type: 'enum',
    required: false,
    maxLength: null,
    options: [
      { value: 'male', label: '男' },
      { value: 'female', label: '女' },
      { value: 'other', label: '其他' },
      { value: 'undisclosed', label: '不愿透露' },
    ],
  },
  { key: 'birthMonth', label: '出生年月', type: 'date', required: false, maxLength: null },
  { key: 'phone', label: '手机', type: 'text', required: false, maxLength: 40 },
  { key: 'email', label: '邮箱', type: 'email', required: false, maxLength: 120 },
  { key: 'city', label: '所在城市', type: 'text', required: false, maxLength: 60 },
  { key: 'website', label: '个人主页', type: 'url', required: false, maxLength: 200 },
  { key: 'github', label: 'GitHub / 作品集', type: 'url', required: false, maxLength: 200 },
  { key: 'wechat', label: '微信', type: 'text', required: false, maxLength: 60 },
  { key: 'notes', label: '备注', type: 'textarea', required: false, maxLength: 1000 },
]

/** Education records. */
const EDUCATION_FIELDS: readonly FieldDescriptor[] = [
  { key: 'school', label: '学校', type: 'text', required: true, maxLength: 120 },
  {
    key: 'degree',
    label: '学历',
    type: 'enum',
    required: true,
    maxLength: null,
    options: [
      { value: 'juniorCollege', label: '大专' },
      { value: 'bachelor', label: '本科' },
      { value: 'master', label: '硕士' },
      { value: 'doctorate', label: '博士' },
      { value: 'other', label: '其他' },
    ],
  },
  { key: 'major', label: '专业', type: 'text', required: false, maxLength: 120 },
  { key: 'startDate', label: '开始时间', type: 'date', required: true, maxLength: null },
  { key: 'endDate', label: '结束时间', type: 'dateOrPresent', required: false, maxLength: null },
  { key: 'gpaRanking', label: 'GPA / 排名', type: 'text', required: false, maxLength: 40 },
  { key: 'courses', label: '主修课程', type: 'textarea', required: false, maxLength: 600 },
  { key: 'description', label: '补充描述', type: 'textarea', required: false, maxLength: 1000 },
]

/** Internship records. */
const INTERNSHIP_FIELDS: readonly FieldDescriptor[] = [
  { key: 'company', label: '公司', type: 'text', required: true, maxLength: 120 },
  { key: 'role', label: '岗位', type: 'text', required: true, maxLength: 80 },
  { key: 'startDate', label: '开始时间', type: 'date', required: true, maxLength: null },
  { key: 'endDate', label: '结束时间', type: 'dateOrPresent', required: false, maxLength: null },
  { key: 'department', label: '部门', type: 'text', required: false, maxLength: 80 },
  { key: 'location', label: '地点', type: 'text', required: false, maxLength: 80 },
  {
    key: 'responsibilities',
    label: '工作职责',
    type: 'textarea',
    required: true,
    maxLength: 2000,
  },
  { key: 'achievements', label: '成果', type: 'textarea', required: false, maxLength: 2000 },
  { key: 'description', label: '补充描述', type: 'textarea', required: false, maxLength: 1000 },
]

/** Project records. */
const PROJECT_FIELDS: readonly FieldDescriptor[] = [
  { key: 'name', label: '项目名称', type: 'text', required: true, maxLength: 120 },
  { key: 'role', label: '角色', type: 'text', required: false, maxLength: 80 },
  { key: 'startDate', label: '开始时间', type: 'date', required: true, maxLength: null },
  { key: 'endDate', label: '结束时间', type: 'dateOrPresent', required: false, maxLength: null },
  { key: 'techStack', label: '技术栈', type: 'text', required: false, maxLength: 200 },
  { key: 'description', label: '项目描述', type: 'textarea', required: false, maxLength: 1500 },
  {
    key: 'responsibilities',
    label: '工作职责',
    type: 'textarea',
    required: false,
    maxLength: 2000,
  },
  { key: 'achievements', label: '成果', type: 'textarea', required: false, maxLength: 2000 },
  { key: 'link', label: '链接', type: 'url', required: false, maxLength: 300 },
]

/** Skill records. */
const SKILL_FIELDS: readonly FieldDescriptor[] = [
  { key: 'name', label: '技能名称', type: 'text', required: true, maxLength: 60 },
  { key: 'category', label: '类别', type: 'text', required: false, maxLength: 40 },
  {
    key: 'level',
    label: '熟练度',
    type: 'enum',
    required: false,
    maxLength: null,
    options: [
      { value: 'aware', label: '了解' },
      { value: 'familiar', label: '熟悉' },
      { value: 'proficient', label: '熟练' },
      { value: 'expert', label: '精通' },
    ],
  },
  { key: 'notes', label: '补充说明', type: 'textarea', required: false, maxLength: 400 },
]

/** Award records. */
const AWARD_FIELDS: readonly FieldDescriptor[] = [
  { key: 'name', label: '名称', type: 'text', required: true, maxLength: 120 },
  {
    key: 'level',
    label: '级别',
    type: 'enum',
    required: false,
    maxLength: null,
    options: [
      { value: 'international', label: '国际' },
      { value: 'national', label: '国家' },
      { value: 'provincial', label: '省级' },
      { value: 'municipal', label: '市级' },
      { value: 'school', label: '校级' },
      { value: 'other', label: '其他' },
    ],
  },
  { key: 'date', label: '时间', type: 'date', required: false, maxLength: null },
  { key: 'description', label: '说明', type: 'textarea', required: false, maxLength: 600 },
]

/** Job intent. */
const JOB_INTENT_FIELDS: readonly FieldDescriptor[] = [
  { key: 'targetRole', label: '目标岗位', type: 'text', required: true, maxLength: 80 },
  { key: 'city', label: '期望城市', type: 'text', required: false, maxLength: 60 },
  { key: 'salaryRange', label: '期望薪资', type: 'text', required: false, maxLength: 60 },
  {
    key: 'employmentType',
    label: '工作类型',
    type: 'enum',
    required: false,
    maxLength: null,
    options: [
      { value: 'fullTime', label: '全职' },
      { value: 'internship', label: '实习' },
      { value: 'partTime', label: '兼职' },
    ],
  },
  { key: 'availableFrom', label: '到岗时间', type: 'date', required: false, maxLength: null },
  { key: 'notes', label: '备注', type: 'textarea', required: false, maxLength: 400 },
]

/** Self evaluation: one free-form statement. */
const SELF_EVALUATION_FIELDS: readonly FieldDescriptor[] = [
  { key: 'content', label: '内容', type: 'textarea', required: true, maxLength: 1200 },
]

/** The field table of the built-in modules. */
export const MODULE_FIELDS: Readonly<
  Record<Exclude<InfoModuleKind, 'custom'>, readonly FieldDescriptor[]>
> = {
  personal: PERSONAL_FIELDS,
  education: EDUCATION_FIELDS,
  internship: INTERNSHIP_FIELDS,
  project: PROJECT_FIELDS,
  skill: SKILL_FIELDS,
  award: AWARD_FIELDS,
  jobIntent: JOB_INTENT_FIELDS,
  selfEvaluation: SELF_EVALUATION_FIELDS,
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const URL_PATTERN = /^https?:\/\/\S+$/
const PHONE_PATTERN = /^[0-9+\-() ]+$/

/**
 * Content checks that belong to one field rather than to its type. The phone
 * field is text in the form but its value is a dialling string, so the pattern
 * is keyed by module and field instead of widening the field types.
 */
const FIELD_CONTENT_PATTERNS: Readonly<
  Partial<Record<InfoModuleKind, Readonly<Record<string, RegExp>>>>
> = {
  personal: { phone: PHONE_PATTERN },
}

function fieldError(
  code: 'blankRequiredField' | 'fieldTooLong' | 'unknownField' | 'invalidFieldValue' | 'endBeforeStart',
  moduleKind: InfoModuleKind,
  fieldKey: string,
  message: string,
): DomainError {
  return new DomainError(code, message, {
    entity: `infoField:${moduleKind}`,
    id: fieldKey,
    blockers: [fieldKey],
  })
}

function customTitleMissing(): DomainError {
  return new DomainError('customModuleNotFound', 'The custom module definition is missing.', {
    entity: 'customModule',
    id: '',
    blockers: [],
  })
}

function customFieldDescriptor(field: CustomFieldDefinition): FieldDescriptor {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    maxLength: field.maxLength,
  }
}

/**
 * The field table of a module. A custom module's table is its title field
 * followed by the declared fields, in declaration order.
 *
 * @throws DomainError `customModuleNotFound` when a custom kind is asked for
 *   without the definition that declares its fields.
 */
export function fieldDescriptors(
  moduleKind: InfoModuleKind,
  custom: CustomModuleDefinition | null,
): readonly FieldDescriptor[] {
  if (moduleKind !== 'custom') return MODULE_FIELDS[moduleKind]
  if (custom === null) throw customTitleMissing()
  return [CUSTOM_TITLE_FIELD, ...custom.fields.map(customFieldDescriptor)]
}

function isKnownKind(moduleKind: string): moduleKind is InfoModuleKind {
  return (INFO_MODULE_KINDS as readonly string[]).includes(moduleKind)
}

/**
 * Validates a raw field record and returns the canonical form that gets stored:
 * every declared key present, optional missing keys as null, strings trimmed,
 * dates canonicalised and flags defaulted to false.
 *
 * The error precedence is the contract's: unknown keys first, then required
 * values, then lengths, then per-type formats, then the start/end order. Each
 * step runs over the whole record before the next one starts, which is what
 * makes that precedence hold.
 *
 * @throws DomainError with a code from the field-validation group.
 */
export function validateFieldValues(
  moduleKind: InfoModuleKind,
  custom: CustomModuleDefinition | null,
  raw: Readonly<Record<string, unknown>>,
): Readonly<Record<string, InfoFieldValue>> {
  if (!isKnownKind(moduleKind)) {
    throw fieldError(
      'invalidFieldValue',
      moduleKind,
      'moduleKind',
      `"${String(moduleKind)}" is not a module kind this build stores.`,
    )
  }
  const descriptors = fieldDescriptors(moduleKind, custom)
  assertNoUnknownKeys(moduleKind, descriptors, raw)
  assertRequiredValues(moduleKind, descriptors, raw)
  const values = normalizeScalarValues(moduleKind, descriptors, raw)
  applyFieldFormats(moduleKind, descriptors, raw, values)
  assertRangeOrder(moduleKind, values)
  return collectNormalizedValues(descriptors, values)
}

/** A value that satisfies "required" only when it is present and not blank. */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

function assertNoUnknownKeys(
  moduleKind: InfoModuleKind,
  descriptors: readonly FieldDescriptor[],
  raw: Readonly<Record<string, unknown>>,
): void {
  const knownKeys = new Set(descriptors.map((descriptor) => descriptor.key))
  for (const key of Object.keys(raw)) {
    if (knownKeys.has(key)) continue
    throw fieldError(
      'unknownField',
      moduleKind,
      key,
      `"${key}" is not a field of module "${moduleKind}".`,
    )
  }
}

function assertRequiredValues(
  moduleKind: InfoModuleKind,
  descriptors: readonly FieldDescriptor[],
  raw: Readonly<Record<string, unknown>>,
): void {
  for (const descriptor of descriptors) {
    if (!descriptor.required) continue
    if (!isBlank(raw[descriptor.key])) continue
    throw fieldError(
      'blankRequiredField',
      moduleKind,
      descriptor.key,
      `The field "${descriptor.key}" is required.`,
    )
  }
}

/** Trims every string and checks its length; non-string values stay for the format step. */
function normalizeScalarValues(
  moduleKind: InfoModuleKind,
  descriptors: readonly FieldDescriptor[],
  raw: Readonly<Record<string, unknown>>,
): Map<string, InfoFieldValue> {
  const values = new Map<string, InfoFieldValue>()
  for (const descriptor of descriptors) {
    const value = raw[descriptor.key]
    values.set(
      descriptor.key,
      typeof value === 'string' ? normalizeTextField(moduleKind, descriptor, value) : null,
    )
  }
  return values
}

function normalizeTextField(
  moduleKind: InfoModuleKind,
  descriptor: FieldDescriptor,
  value: string,
): string | null {
  const text = value.trim()
  if (text === '') return null
  if (descriptor.maxLength !== null && countCodePoints(text) > descriptor.maxLength) {
    throw fieldError(
      'fieldTooLong',
      moduleKind,
      descriptor.key,
      `The field "${descriptor.key}" may be at most ${descriptor.maxLength.toString()} characters.`,
    )
  }
  return text
}

function applyFieldFormats(
  moduleKind: InfoModuleKind,
  descriptors: readonly FieldDescriptor[],
  raw: Readonly<Record<string, unknown>>,
  values: Map<string, InfoFieldValue>,
): void {
  for (const descriptor of descriptors) {
    applyFieldFormat(moduleKind, descriptor, raw[descriptor.key], values)
  }
}

function applyFieldFormat(
  moduleKind: InfoModuleKind,
  descriptor: FieldDescriptor,
  rawValue: unknown,
  values: Map<string, InfoFieldValue>,
): void {
  if (descriptor.type === 'bool') {
    applyBooleanFormat(moduleKind, descriptor, rawValue, values)
    return
  }
  const value = values.get(descriptor.key)
  if (typeof value !== 'string') {
    if (rawValue === undefined || rawValue === null) return
    throw fieldError(
      'invalidFieldValue',
      moduleKind,
      descriptor.key,
      `The field "${descriptor.key}" must be text.`,
    )
  }
  assertContentPattern(moduleKind, descriptor, value)
  validateTypedFormat(moduleKind, descriptor, value, values)
}

function applyBooleanFormat(
  moduleKind: InfoModuleKind,
  descriptor: FieldDescriptor,
  rawValue: unknown,
  values: Map<string, InfoFieldValue>,
): void {
  if (rawValue === undefined || rawValue === null) {
    values.set(descriptor.key, false)
    return
  }
  if (typeof rawValue !== 'boolean') {
    throw fieldError(
      'invalidFieldValue',
      moduleKind,
      descriptor.key,
      `The field "${descriptor.key}" must be true or false.`,
    )
  }
  values.set(descriptor.key, rawValue)
}

/** The content rule of a single field (the phone dialling characters, today). */
function assertContentPattern(
  moduleKind: InfoModuleKind,
  descriptor: FieldDescriptor,
  value: string,
): void {
  const pattern = FIELD_CONTENT_PATTERNS[moduleKind]?.[descriptor.key]
  if (pattern !== undefined && !pattern.test(value)) {
    throw fieldError(
      'invalidFieldValue',
      moduleKind,
      descriptor.key,
      `The field "${descriptor.key}" does not have an accepted format.`,
    )
  }
}

function validateTypedFormat(
  moduleKind: InfoModuleKind,
  descriptor: FieldDescriptor,
  value: string,
  values: Map<string, InfoFieldValue>,
): void {
  switch (descriptor.type) {
    case 'text':
    case 'textarea':
    case 'bool':
      return
    case 'email':
      assertPattern(moduleKind, descriptor, EMAIL_PATTERN, value, 'an email address')
      return
    case 'url':
      assertPattern(moduleKind, descriptor, URL_PATTERN, value, 'an http or https URL')
      return
    case 'enum':
      assertEnumValue(moduleKind, descriptor, value)
      return
    case 'date':
    case 'dateOrPresent':
      values.set(descriptor.key, parseDateValue(moduleKind, descriptor, value))
  }
}

function assertPattern(
  moduleKind: InfoModuleKind,
  descriptor: FieldDescriptor,
  pattern: RegExp,
  value: string,
  expected: string,
): void {
  if (pattern.test(value)) return
  throw fieldError(
    'invalidFieldValue',
    moduleKind,
    descriptor.key,
    `The field "${descriptor.key}" must be ${expected}.`,
  )
}

function assertEnumValue(
  moduleKind: InfoModuleKind,
  descriptor: FieldDescriptor,
  value: string,
): void {
  if ((descriptor.options ?? []).some((option) => option.value === value)) return
  throw fieldError(
    'invalidFieldValue',
    moduleKind,
    descriptor.key,
    `"${value}" is not a value the field "${descriptor.key}" accepts.`,
  )
}

/** Parses a date field and rejects `present` for a start-only date. */
function parseDateValue(
  moduleKind: InfoModuleKind,
  descriptor: FieldDescriptor,
  value: string,
): InfoFieldValue {
  const parsed = parseKnowledgeDate(value)
  if (parsed === null) {
    throw fieldError(
      'invalidFieldValue',
      moduleKind,
      descriptor.key,
      `The field "${descriptor.key}" must be a year, a year and month, or present.`,
    )
  }
  if (descriptor.type === 'date' && parsed === PRESENT) {
    throw fieldError(
      'invalidFieldValue',
      moduleKind,
      descriptor.key,
      `The field "${descriptor.key}" cannot be present.`,
    )
  }
  return parsed
}

/** A range must not end before it starts; `present` is later than any date. */
function assertRangeOrder(
  moduleKind: InfoModuleKind,
  values: ReadonlyMap<string, InfoFieldValue>,
): void {
  const start = values.get('startDate')
  const end = values.get('endDate')
  if (typeof start !== 'string' || typeof end !== 'string' || end === PRESENT) return
  const startDate = parseKnowledgeDate(start)
  const endDate = parseKnowledgeDate(end)
  if (startDate === null || endDate === null) return
  if (compareKnowledgeDate(startDate, endDate) <= 0) return
  throw fieldError(
    'endBeforeStart',
    moduleKind,
    'endDate',
    'The end date must not be earlier than the start date.',
  )
}

function collectNormalizedValues(
  descriptors: readonly FieldDescriptor[],
  values: ReadonlyMap<string, InfoFieldValue>,
): Readonly<Record<string, InfoFieldValue>> {
  const normalized: Record<string, InfoFieldValue> = {}
  for (const descriptor of descriptors) {
    normalized[descriptor.key] = values.get(descriptor.key) ?? null
  }
  return normalized
}
