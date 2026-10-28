/**
 * @file ChangeRecord.test
 * @description The closed value sets of the append-only change record: the row
 * mapper relies on these guards to reject a stored operation it does not know.
 */

import { describe, expect, it } from 'vitest'

import {
  CHANGE_OPS,
  CHANGE_SCOPES,
  isChangeOp,
  isChangeOrigin,
  isChangeScope,
} from '../../../src/domain/changes/ChangeRecord'

describe('change record value sets', () => {
  it('accepts every declared scope and operation', () => {
    for (const scope of CHANGE_SCOPES) expect(isChangeScope(scope)).toBe(true)
    for (const op of CHANGE_OPS) expect(isChangeOp(op)).toBe(true)
    expect(isChangeOrigin('user')).toBe(true)
    expect(isChangeOrigin('agent')).toBe(true)
  })

  it('rejects values outside the closed sets', () => {
    expect(isChangeScope('resume')).toBe(false)
    expect(isChangeOp('infoEntry.archive')).toBe(false)
    expect(isChangeOrigin('system')).toBe(false)
    expect(isChangeOp(null)).toBe(false)
    expect(isChangeScope(1)).toBe(false)
  })
})
