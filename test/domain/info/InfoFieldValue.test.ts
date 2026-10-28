/**
 * @file InfoFieldValue.test
 * @description The field-validation matrix: required values, code-point lengths,
 * enumerations, dates, formats, the start/end order and the precedence of the
 * error codes.
 */

import { describe, expect, it } from 'vitest'

import { fieldDescriptors, validateFieldValues } from '../../../src/domain/info/InfoFieldValue'
import { customFieldsFixture, customModuleFixture, validRawFields } from '../../support/infoFixtures'
import { expectDomainError } from '../../support/domainErrors'

describe('fieldDescriptors', () => {
  it('declares every built-in module with a title field', () => {
    for (const kind of [
      'personal',
      'education',
      'internship',
      'project',
      'skill',
      'award',
      'jobIntent',
      'selfEvaluation',
    ] as const) {
      const descriptors = fieldDescriptors(kind, null)
      expect(descriptors.length).toBeGreaterThan(0)
      expect(descriptors.every((descriptor) => descriptor.label !== '')).toBe(true)
    }
  })

  it('puts the built-in title field before the declared fields of a custom module', () => {
    const descriptors = fieldDescriptors('custom', customModuleFixture())
    expect(descriptors.map((descriptor) => descriptor.key)).toEqual([
      'title',
      ...customFieldsFixture().map((field) => field.key),
    ])
    expect(descriptors[0]).toMatchObject({ label: '标题', required: true, maxLength: 80 })
  })

  it('reports a custom module that has no definition', () => {
    expectDomainError(() => fieldDescriptors('custom', null), 'customModuleNotFound')
  })
})

describe('validateFieldValues', () => {
  it('fills every optional field with null and trims the given text', () => {
    const normalized = validateFieldValues('personal', null, {
      fullName: '  张三  ',
      phone: ' +86 138 0000 0000 ',
    })
    expect(normalized.fullName).toBe('张三')
    expect(normalized.phone).toBe('+86 138 0000 0000')
    expect(normalized.gender).toBeNull()
    expect(normalized.notes).toBeNull()
    expect(Object.keys(normalized)).toEqual(
      fieldDescriptors('personal', null).map((descriptor) => descriptor.key),
    )
  })

  it('keeps the internal newlines of a textarea', () => {
    const normalized = validateFieldValues('selfEvaluation', null, {
      content: '第一行\n第二行\n第三行',
    })
    expect(normalized.content).toBe('第一行\n第二行\n第三行')
  })

  it('rejects an unknown field before anything else', () => {
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: '', nickName: 'x' }),
      'unknownField',
    )
  })

  it('reports a missing required value with blankRequiredField', () => {
    expectDomainError(() => validateFieldValues('personal', null, {}), 'blankRequiredField')
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: '   ' }),
      'blankRequiredField',
    )
  })

  it('reports a missing required enumeration or date as a required value', () => {
    expectDomainError(
      () => validateFieldValues('education', null, { school: '复旦大学', startDate: '2021-09' }),
      'blankRequiredField',
    )
    expectDomainError(
      () => validateFieldValues('education', null, { school: '复旦大学', degree: 'bachelor' }),
      'blankRequiredField',
    )
  })

  it('bounds a text field by code points, not UTF-16 units', () => {
    expect(() =>
      validateFieldValues('personal', null, { fullName: 'a'.repeat(80) }),
    ).not.toThrow()
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: 'a'.repeat(81) }),
      'fieldTooLong',
    )
    // Eighty emoji are 160 UTF-16 units but eighty code points.
    expect(() =>
      validateFieldValues('personal', null, { fullName: '🎓'.repeat(80) }),
    ).not.toThrow()
  })

  it('checks lengths before formats', () => {
    expectDomainError(
      () =>
        validateFieldValues('personal', null, {
          fullName: 'a'.repeat(81),
          gender: 'unknown',
        }),
      'fieldTooLong',
    )
  })

  it('rejects an enumeration value outside the declared options', () => {
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: '张三', gender: 'robot' }),
      'invalidFieldValue',
    )
    expect(() =>
      validateFieldValues('personal', null, { fullName: '张三', gender: 'undisclosed' }),
    ).not.toThrow()
  })

  it('validates email, URL and phone formats', () => {
    expect(() =>
      validateFieldValues('personal', null, {
        fullName: '张三',
        email: 'zhang@example.com',
        website: 'https://example.com/resume',
        github: 'http://github.com/zhang',
        phone: '+86 (021) 555-0100',
      }),
    ).not.toThrow()
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: '张三', email: 'not-an-email' }),
      'invalidFieldValue',
    )
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: '张三', website: 'ftp://example.com' }),
      'invalidFieldValue',
    )
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: '张三', phone: '138-abc' }),
      'invalidFieldValue',
    )
  })

  it('rejects a month outside the calendar range', () => {
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: '张三', birthMonth: '2024-13' }),
      'invalidFieldValue',
    )
    expect(() =>
      validateFieldValues('personal', null, { fullName: '张三', birthMonth: '2024-12' }),
    ).not.toThrow()
  })

  it('rejects present as a start date but accepts it as an end date', () => {
    expectDomainError(
      () =>
        validateFieldValues('internship', null, {
          company: '某公司',
          role: '开发',
          startDate: 'present',
          responsibilities: '职责',
        }),
      'invalidFieldValue',
    )
    const normalized = validateFieldValues('internship', null, {
      company: '某公司',
      role: '开发',
      startDate: '2024-06',
      endDate: 'present',
      responsibilities: '职责',
    })
    expect(normalized.endDate).toBe('present')
  })

  it('rejects a range that ends before it starts', () => {
    expectDomainError(
      () =>
        validateFieldValues('project', null, {
          name: '项目',
          startDate: '2024-06',
          endDate: '2024-05',
        }),
      'endBeforeStart',
    )
    // A year-only value counts as January, so an equal year is not before.
    expect(() =>
      validateFieldValues('project', null, {
        name: '项目',
        startDate: '2024',
        endDate: '2024-01',
      }),
    ).not.toThrow()
  })

  it('rejects a non-text value for a text field', () => {
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: 42 }),
      'invalidFieldValue',
    )
    expectDomainError(
      () => validateFieldValues('personal', null, { fullName: '张三', gender: 1 }),
      'invalidFieldValue',
    )
  })

  it('rejects a module kind outside the closed set', () => {
    expectDomainError(
      () => validateFieldValues('bogus' as never, null, {}),
      'invalidFieldValue',
    )
  })

  it('validates a custom entry against the definition', () => {
    const custom = customModuleFixture()
    const normalized = validateFieldValues('custom', custom, {
      title: ' CET-6 ',
      f_11111111: '大学英语六级',
    })
    expect(normalized.title).toBe('CET-6')
    expect(normalized.f_11111111).toBe('大学英语六级')
    expect(normalized.f_22222222).toBeNull()
    expectDomainError(() => validateFieldValues('custom', custom, {}), 'blankRequiredField')
    expectDomainError(
      () => validateFieldValues('custom', custom, { title: 'CET-6', f_deadbeef: 'x' }),
      'unknownField',
    )
    expectDomainError(
      () =>
        validateFieldValues('custom', custom, {
          title: 'CET-6',
          f_11111111: 'a'.repeat(121),
        }),
      'fieldTooLong',
    )
    expectDomainError(() => validateFieldValues('custom', null, {}), 'customModuleNotFound')
  })

  it('accepts a complete record of every built-in module', () => {
    for (const kind of [
      'personal',
      'education',
      'internship',
      'project',
      'skill',
      'award',
      'jobIntent',
      'selfEvaluation',
    ] as const) {
      expect(() => validateFieldValues(kind, null, validRawFields(kind))).not.toThrow()
    }
  })
})
