/**
 * @file bootFailure.test
 * @description How the reason on the failure screen is taken from whatever the
 * native container rejected with. Native plugins can reject with a string or a
 * plain object rather than an Error, so the reader has to cover those shapes;
 * anything it cannot recognise is serialised rather than replaced by an
 * unknown-cause message.
 */

import { describe, expect, it } from 'vitest'

import { describeBootFailure } from '../../../src/presentation/app/errorMessages'

describe('describeBootFailure', () => {
  it('reports the message of an Error', () => {
    expect(describeBootFailure(new Error('数据库被占用'))).toBe('数据库被占用')
  })

  it('reports a rejection that is already a string', () => {
    expect(describeBootFailure('error returned from database: unable to open database file')).toBe(
      'error returned from database: unable to open database file',
    )
  })

  it('reads the message field of a rejected object', () => {
    expect(describeBootFailure({ message: 'table provider_config already exists' })).toBe(
      'table provider_config already exists',
    )
  })

  it('reads the error field of a rejected object', () => {
    expect(describeBootFailure({ error: 'credentials refused' })).toBe('credentials refused')
  })

  it('serialises an object with no recognised field', () => {
    expect(describeBootFailure({ code: 5, detail: 'database is locked' })).toBe(
      '{"code":5,"detail":"database is locked"}',
    )
  })

  it('reports an undefined rejection as itself instead of failing', () => {
    expect(describeBootFailure(undefined)).toBe('undefined')
  })

  it('falls back to the value when it cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(describeBootFailure(cyclic)).toBe('[object Object]')
  })
})
