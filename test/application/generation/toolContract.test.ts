/**
 * @file toolContract.test
 * @description The two conventions a tool's result shares with the run loop:
 * the refusal discriminator the loop reads, and the metadata keys it lifts into
 * the audit row. Both are read by name from an `unknown` result, so these cases
 * pin the names: a typo in a tool's return value must not silently empty the
 * card's undo affordance or turn a tool's own data into a refusal.
 */

import { describe, expect, it } from 'vitest'

import { DomainError } from '../../../src/domain/shared/DomainError'
import {
  readToolOutcomeMetadata,
  successResultJson,
} from '../../../src/application/generation/toolOutcome'
import { executeSafely, toolFailure } from '../../../src/application/generation/tools/toolSchema'

describe('tool failure discriminator', () => {
  it('marks a refused call with the kind the loop reads', () => {
    const refusal = toolFailure(
      new DomainError('entryNotFound', 'The entry is gone.', {
        entity: 'infoEntry',
        id: 'entry-1',
        blockers: [],
      }),
    )

    expect(refusal).toMatchObject({ kind: 'toolFailure', ok: false })
    expect(refusal.error).toContain('entryNotFound')
  })

  it('converts a domain refusal through executeSafely', async () => {
    const refusal = await executeSafely(async () => {
      throw new DomainError('invalidFieldValue', 'Wrong shape.', {
        entity: 'infoEntry',
        id: 'entry-1',
        blockers: [],
      })
    })

    expect(refusal).toMatchObject({ kind: 'toolFailure', ok: false })
  })

  it('lets a programming fault escape instead of turning it into a refusal', async () => {
    await expect(
      executeSafely(async () => {
        throw new TypeError('boom')
      }),
    ).rejects.toThrow(TypeError)
  })
})

describe('tool outcome metadata keys', () => {
  it('reads the identifiers the tool table promises', () => {
    const metadata = readToolOutcomeMetadata({
      changeId: 'change-1',
      revisionId: 'revision-1',
      resumeId: 'resume-1',
    })

    expect(metadata.changeIds).toEqual(['change-1'])
    expect(metadata.revisionId).toBe('revision-1')
    expect(metadata.resumeId).toBe('resume-1')
  })

  it('reads a changeIds array as well as the single changeId', () => {
    expect(readToolOutcomeMetadata({ changeIds: ['a', 'b'] }).changeIds).toEqual(['a', 'b'])
  })

  it('reads a value outside the success envelope', () => {
    // A tool may hand back its own value; the metadata is read from the value
    // the caller sees after unwrapping `{ ok: true, value }`.
    const envelope = JSON.parse(successResultJson({ changeIds: ['c1'], revisionId: 'r1' }))
    const metadata = readToolOutcomeMetadata(envelope.value)

    expect(metadata).toEqual({ changeIds: ['c1'], revisionId: 'r1', resumeId: null })
  })

  it('returns the empty metadata for a payload that names nothing', () => {
    expect(readToolOutcomeMetadata({ unrelated: true })).toEqual({
      changeIds: [],
      revisionId: null,
      resumeId: null,
    })
    expect(readToolOutcomeMetadata(null)).toEqual({
      changeIds: [],
      revisionId: null,
      resumeId: null,
    })
  })
})
