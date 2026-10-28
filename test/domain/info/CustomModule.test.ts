/**
 * @file CustomModule.test
 * @description The rules of a custom module definition: name bounds, immutable
 * field-key format, declared field count and each field's own bounds.
 */

import { describe, expect, it } from 'vitest'

import {
  nextCustomFieldKey,
  normalizeCustomModuleName,
  validateCustomFieldDefinition,
  validateCustomModuleDefinition,
} from '../../../src/domain/info/CustomModule'
import type { CustomFieldDefinition } from '../../../src/domain/info/CustomModule'
import { asCustomFieldKey, asCustomModuleId } from '../../../src/domain/shared/branded-id'
import { customFieldsFixture, customModuleFixture, FIXTURE_TIME } from '../../support/infoFixtures'
import { expectDomainError } from '../../support/domainErrors'
import { SequentialIdGenerator } from '../../support/fakeEnvironment'

function field(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  return { ...(customFieldsFixture()[0] as CustomFieldDefinition), ...overrides }
}

describe('normalizeCustomModuleName', () => {
  it('trims a name and keeps the usable value', () => {
    expect(normalizeCustomModuleName('  证书  ')).toBe('证书')
  })

  it('rejects a blank name', () => {
    expectDomainError(() => normalizeCustomModuleName('   '), 'blankRequiredField')
  })

  it('counts code points and rejects a name over twenty', () => {
    expect(normalizeCustomModuleName('a'.repeat(20))).toHaveLength(20)
    expectDomainError(() => normalizeCustomModuleName('a'.repeat(21)), 'fieldTooLong')
    expect(normalizeCustomModuleName('🎓'.repeat(20))).toHaveLength(40)
  })
})

describe('nextCustomFieldKey', () => {
  it('derives the fixed f_ + eight lowercase hex format from the identifier source', () => {
    const key = nextCustomFieldKey(new SequentialIdGenerator('field'))
    expect(key).toMatch(/^f_[0-9a-f]{8}$/u)
  })

  it('produces different keys for different identifiers', () => {
    const ids = new SequentialIdGenerator('field')
    const keys = new Set([
      nextCustomFieldKey(ids),
      nextCustomFieldKey(ids),
      nextCustomFieldKey(ids),
    ])
    expect(keys.size).toBe(3)
  })

  it('is stable for the same identifier seed', () => {
    expect(nextCustomFieldKey(new SequentialIdGenerator('field'))).toBe(
      nextCustomFieldKey(new SequentialIdGenerator('field')),
    )
  })
})

describe('validateCustomFieldDefinition', () => {
  it('accepts a valid field', () => {
    expect(() => validateCustomFieldDefinition(field())).not.toThrow()
  })

  it('rejects a key outside the stored format', () => {
    expectDomainError(
      () => validateCustomFieldDefinition(field({ key: asCustomFieldKey('f_ABC12345') })),
      'invalidFieldValue',
    )
  })

  it('rejects the built-in title key', () => {
    expectDomainError(
      () => validateCustomFieldDefinition(field({ key: asCustomFieldKey('title') })),
      'duplicateFieldKey',
    )
  })

  it('rejects an unknown type', () => {
    expectDomainError(
      () => validateCustomFieldDefinition(field({ type: 'date' as never })),
      'invalidFieldValue',
    )
  })

  it('rejects a blank and an over-long label', () => {
    expectDomainError(() => validateCustomFieldDefinition(field({ label: ' ' })), 'blankRequiredField')
    expectDomainError(
      () => validateCustomFieldDefinition(field({ label: '字'.repeat(21) })),
      'fieldTooLong',
    )
  })

  it('bounds the declared maximum length by the field type', () => {
    expect(() => validateCustomFieldDefinition(field({ maxLength: 200 }))).not.toThrow()
    expectDomainError(() => validateCustomFieldDefinition(field({ maxLength: 201 })), 'fieldTooLong')
    expectDomainError(() => validateCustomFieldDefinition(field({ maxLength: 0 })), 'invalidFieldValue')
    expectDomainError(
      () => validateCustomFieldDefinition(field({ type: 'textarea', maxLength: 2001 })),
      'fieldTooLong',
    )
    expect(() => validateCustomFieldDefinition(field({ type: 'textarea', maxLength: 2000 }))).not.toThrow()
  })
})

describe('validateCustomModuleDefinition', () => {
  it('accepts a definition with one field and rejects none', () => {
    expect(() => validateCustomModuleDefinition(customModuleFixture())).not.toThrow()
    expect(() =>
      validateCustomModuleDefinition({ ...customModuleFixture(), fields: [] }),
    ).toThrow()
    expectDomainError(
      () => validateCustomModuleDefinition({ ...customModuleFixture(), fields: [] }),
      'blankRequiredField',
    )
  })

  it('rejects more than twelve fields', () => {
    const fields = Array.from({ length: 13 }, (_, index) =>
      field({ key: asCustomFieldKey(`f_0000000${index.toString(16)}`) }),
    )
    expectDomainError(
      () => validateCustomModuleDefinition({ ...customModuleFixture(), fields }),
      'customFieldLimit',
    )
  })

  it('rejects two fields with the same key', () => {
    const fields = [field(), field()]
    expectDomainError(
      () => validateCustomModuleDefinition({ ...customModuleFixture(), fields }),
      'duplicateFieldKey',
    )
  })

  it('rejects a sort order below one', () => {
    expectDomainError(
      () => validateCustomModuleDefinition({ ...customModuleFixture(), sortOrder: 0 }),
      'invalidFieldValue',
    )
  })

  it('rejects an invalid stored name', () => {
    expectDomainError(
      () =>
        validateCustomModuleDefinition({
          ...customModuleFixture(),
          name: '',
          id: asCustomModuleId('module-x'),
          createdAt: FIXTURE_TIME,
          updatedAt: FIXTURE_TIME,
        }),
      'blankRequiredField',
    )
  })
})
