/**
 * @file infoFixtures
 * @description Factory functions for information-library values. They are
 * functions, not shared objects, so a test that mutates one value cannot affect
 * another test.
 */

import type {
  CustomFieldDefinition,
  CustomModuleDefinition,
} from '../../src/domain/info/CustomModule'
import type { InfoModuleKind } from '../../src/domain/info/InfoModuleKind'
import type { InfoEntry } from '../../src/domain/info/InfoEntry'
import { deriveEntryTitle } from '../../src/domain/info/InfoEntry'
import { validateFieldValues } from '../../src/domain/info/InfoFieldValue'
import type { InfoFieldValue } from '../../src/domain/info/InfoFieldValue'
import {
  asCustomFieldKey,
  asCustomModuleId,
  asInfoEntryId,
} from '../../src/domain/shared/branded-id'
import type { CustomModuleId } from '../../src/domain/shared/branded-id'
import { parseDateTime } from '../../src/domain/shared/DateTime'
import type { DateTime } from '../../src/domain/shared/DateTime'

export const FIXTURE_TIME: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

/** A complete raw field record that validates for the module. */
export function validRawFields(
  moduleKind: Exclude<InfoModuleKind, 'custom'>,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const base: Record<Exclude<InfoModuleKind, 'custom'>, Record<string, unknown>> = {
    personal: { fullName: '张三' },
    education: { school: '复旦大学', degree: 'master', startDate: '2021-09', endDate: 'present' },
    internship: {
      company: '某公司',
      role: '后端开发',
      startDate: '2024-06',
      responsibilities: '负责订单服务。',
    },
    project: { name: '订单中台', startDate: '2024-01' },
    skill: { name: 'TypeScript' },
    award: { name: '数学建模竞赛' },
    jobIntent: { targetRole: '后端开发工程师' },
    selfEvaluation: { content: '三年后端开发经验。' },
  }
  return { ...base[moduleKind], ...overrides }
}

/** A custom module with one text field and one textarea field. */
export function customModuleFixture(
  overrides: Partial<CustomModuleDefinition> = {},
): CustomModuleDefinition {
  return {
    id: asCustomModuleId('module-certificates'),
    name: '证书',
    fields: customFieldsFixture(),
    sortOrder: 1,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    ...overrides,
  }
}

export function customFieldsFixture(): readonly [CustomFieldDefinition, CustomFieldDefinition] {
  return [
    {
      key: asCustomFieldKey('f_11111111'),
      label: '证书名称',
      type: 'text',
      required: true,
      maxLength: 120,
    },
    {
      key: asCustomFieldKey('f_22222222'),
      label: '说明',
      type: 'textarea',
      required: false,
      maxLength: 600,
    },
  ]
}

/** A stored entry built through the same normalization the use cases use. */
export function infoEntryFixture(input: {
  readonly id: string
  readonly moduleKind: InfoModuleKind
  readonly fields: Readonly<Record<string, unknown>>
  readonly customModule?: CustomModuleDefinition | null
  readonly sortOrder?: number
  readonly origin?: InfoEntry['origin']
  readonly sourceRunId?: InfoEntry['sourceRunId']
  readonly createdAt?: DateTime
  readonly updatedAt?: DateTime
}): InfoEntry {
  const customModule = input.customModule ?? null
  const customModuleId: CustomModuleId | null =
    input.moduleKind === 'custom' ? (customModule?.id ?? asCustomModuleId('module-certificates')) : null
  const fields: Readonly<Record<string, InfoFieldValue>> = validateFieldValues(
    input.moduleKind,
    customModule,
    input.fields,
  )
  return {
    id: asInfoEntryId(input.id),
    moduleKind: input.moduleKind,
    customModuleId,
    title: deriveEntryTitle(input.moduleKind, customModule, fields),
    fields,
    sortOrder: input.sortOrder ?? 1,
    origin: input.origin ?? 'user',
    sourceRunId: input.sourceRunId ?? null,
    createdAt: input.createdAt ?? FIXTURE_TIME,
    updatedAt: input.updatedAt ?? FIXTURE_TIME,
  }
}
