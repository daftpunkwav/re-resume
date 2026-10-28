/**
 * @file infoReveal.test
 * @description How a reveal request becomes the module and entry the panel
 * opens: the entry wins, a custom module selects its module, and an empty
 * request opens nothing.
 */

import { describe, expect, it } from 'vitest'

import { resolveRevealSelection } from '../../../../src/presentation/features/info/infoReveal'
import type { InfoRevealRequest } from '../../../../src/presentation/features/info/stores/infoStore'
import type { InfoEntry } from '../../../../src/domain/info/InfoEntry'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import {
  asCustomModuleId,
  asInfoEntryId,
} from '../../../../src/domain/shared/branded-id'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

const ENTRY: InfoEntry = {
  id: asInfoEntryId('entry-1'),
  moduleKind: 'education',
  customModuleId: null,
  title: '示例大学',
  fields: {},
  sortOrder: 1,
  origin: 'user',
  sourceRunId: null,
  createdAt: AT,
  updatedAt: AT,
}

function request(overrides: Partial<InfoRevealRequest>): InfoRevealRequest {
  return {
    entryIds: [],
    moduleKind: null,
    customModuleId: null,
    nonce: 1,
    ...overrides,
  }
}

describe('resolveRevealSelection', () => {
  it('selects the module and entry a changed entry belongs to', () => {
    expect(resolveRevealSelection([ENTRY], request({ entryIds: [ENTRY.id] }))).toEqual({
      selection: { moduleKind: 'education', customModuleId: null },
      entryId: 'entry-1',
    })
  })

  it('selects a custom module without an entry', () => {
    expect(
      resolveRevealSelection([], request({ customModuleId: asCustomModuleId('module-1') })),
    ).toEqual({
      selection: { moduleKind: 'custom', customModuleId: 'module-1' },
      entryId: null,
    })
  })

  it('opens nothing for a request that names no target', () => {
    expect(resolveRevealSelection([ENTRY], request({}))).toBeNull()
  })
})
