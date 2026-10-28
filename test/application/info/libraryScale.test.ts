/**
 * @file libraryScale.test
 * @description The information library at the storage budget: 2000 entries.
 * Listing one module and searching the whole library are the two reads the panel
 * performs on every keystroke, so both are measured against the SPEC section 14
 * budget (500 entries first screen under 100 ms, with 2000 entries as the worst
 * case the storage allows).
 */

import { describe, expect, it } from 'vitest'

import { listInfoEntries } from '../../../src/application/info/listInfoEntries'
import { searchInfoEntries } from '../../../src/application/info/searchInfoEntries'
import type { InfoEntry } from '../../../src/domain/info/InfoEntry'
import { infoEntryFixture } from '../../support/infoFixtures'
import { newInfoLibrary } from '../../support/infoLibrary'

const ENTRY_COUNT = 2000
const BUDGET_MS = 100

function largeLibrary(): readonly InfoEntry[] {
  return Array.from({ length: ENTRY_COUNT }, (_, index) =>
    infoEntryFixture({
      id: `education-${index.toString()}`,
      moduleKind: 'education',
      sortOrder: index + 1,
      fields: {
        school: `第 ${index.toString()} 所学校`,
        degree: 'bachelor',
        startDate: '2019-09',
        endDate: 'present',
        major: index % 7 === 0 ? '计算机科学' : `专业 ${index.toString()}`,
      },
    }),
  )
}

describe('the information library at scale', () => {
  it('lists one module of 2000 entries within the read budget', async () => {
    const library = newInfoLibrary({ entries: largeLibrary() })
    const startedAt = performance.now()
    const output = await listInfoEntries(library.deps, { moduleKind: 'education' })
    const elapsed = performance.now() - startedAt
    expect(output.entries).toHaveLength(ENTRY_COUNT)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  it('searches the whole library within the keystroke budget', async () => {
    const library = newInfoLibrary({ entries: largeLibrary() })
    const startedAt = performance.now()
    const output = await searchInfoEntries(library.deps, { keyword: '计算机科学' })
    const elapsed = performance.now() - startedAt
    expect(output.hits.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })
})
