/**
 * @file searchInfoEntries.test
 * @description Keyword search: weighting, matching fields, snippets, tie order,
 * the limit bounds and the input contract.
 */

import { describe, expect, it } from 'vitest'

import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_KEYWORD_MAX_LENGTH,
  SEARCH_MAX_LIMIT,
  searchInfoEntries,
} from '../../../src/application/info/searchInfoEntries'
import { asInfoEntryId } from '../../../src/domain/shared/branded-id'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { InfoEntry } from '../../../src/domain/info/InfoEntry'
import { infoEntryFixture, validRawFields } from '../../support/infoFixtures'
import { newInfoLibrary } from '../../support/infoLibrary'
import { expectDomainErrorAsync } from '../../support/domainErrors'

const LATER = parseDateTime('2026-02-01T00:00:00.000Z')!

function entry(
  id: string,
  moduleKind: 'project' | 'skill',
  fields: Readonly<Record<string, unknown>>,
  updatedAt = LATER,
): InfoEntry {
  return infoEntryFixture({ id, moduleKind, fields, updatedAt, createdAt: updatedAt })
}

describe('searchInfoEntries', () => {
  it('weights a title match above a field match', async () => {
    const titleMatch = entry('project-title', 'project', { name: '订单中台', startDate: '2024-01' })
    const fieldMatch = entry('project-field', 'project', {
      name: '结算平台',
      startDate: '2024-01',
      description: '订单中台的迁移项目',
    })
    const library = newInfoLibrary({ entries: [titleMatch, fieldMatch] })

    const result = await searchInfoEntries(library.deps, { keyword: '订单' })

    expect(result.hits.map((hit) => hit.entryId)).toEqual(['project-title', 'project-field'])
    // The title is derived from the name field, so both count for the first hit.
    expect(result.hits[0]).toMatchObject({ score: 4, matchedOn: ['title', 'name'] })
    expect(result.hits[1]).toMatchObject({ score: 1, matchedOn: ['description'] })
  })

  it('reports every matched field and a snippet of the first match', async () => {
    const record = entry(
      'project-1',
      'project',
      {
        name: '订单中台',
        startDate: '2024-01',
        description: '负责订单结算与对账，支撑订单峰值每秒三千笔。',
      },
      LATER,
    )
    const library = newInfoLibrary({ entries: [record] })

    const result = await searchInfoEntries(library.deps, { keyword: '订单' })

    expect(result.hits[0]?.matchedOn).toEqual(['title', 'name', 'description'])
    expect(result.hits[0]?.score).toBe(5)
    expect(result.hits[0]?.snippet).toContain('订单')
  })

  it('matches case-insensitively', async () => {
    const record = entry('skill-1', 'skill', { name: 'TypeScript' }, LATER)
    const library = newInfoLibrary({ entries: [record] })

    const result = await searchInfoEntries(library.deps, { keyword: 'typescript' })
    expect(result.hits.map((hit) => hit.entryId)).toEqual(['skill-1'])
  })

  it('orders equal scores by recency and then by identifier', async () => {
    const older = entry('project-a', 'project', { name: '订单一', startDate: '2024-01' })
    const newer = entry('project-b', 'project', {
      name: '订单二',
      startDate: '2024-01',
    }, parseDateTime('2026-03-01T00:00:00.000Z')!)
    const sameNewer = entry('project-c', 'project', {
      name: '订单三',
      startDate: '2024-01',
    }, parseDateTime('2026-03-01T00:00:00.000Z')!)
    const library = newInfoLibrary({ entries: [older, newer, sameNewer] })

    const result = await searchInfoEntries(library.deps, { keyword: '订单' })

    // Same score: the newer pair first, ordered by identifier; the older last.
    expect(result.hits.map((hit) => hit.entryId)).toEqual(['project-b', 'project-c', 'project-a'])
  })

  it('filters by module kind', async () => {
    const project = entry('project-1', 'project', { name: '订单中台', startDate: '2024-01' })
    const skill = entry('skill-1', 'skill', { name: '订单系统' })
    const library = newInfoLibrary({ entries: [project, skill] })

    const result = await searchInfoEntries(library.deps, {
      keyword: '订单',
      moduleKinds: ['skill'],
    })
    expect(result.hits.map((hit) => hit.entryId)).toEqual(['skill-1'])
  })

  it('defaults to twenty hits and clamps a limit above fifty', async () => {
    const entries = Array.from({ length: 60 }, (_, index) =>
      entry(`project-${index.toString().padStart(2, '0')}`, 'project', {
        name: `订单项目 ${index.toString()}`,
        startDate: '2024-01',
      }),
    )
    const library = newInfoLibrary({ entries })

    const defaults = await searchInfoEntries(library.deps, { keyword: '订单' })
    expect(defaults.hits).toHaveLength(SEARCH_DEFAULT_LIMIT)

    const clamped = await searchInfoEntries(library.deps, { keyword: '订单', limit: 999 })
    expect(clamped.hits).toHaveLength(SEARCH_MAX_LIMIT)

    const one = await searchInfoEntries(library.deps, { keyword: '订单', limit: 1 })
    expect(one.hits).toHaveLength(1)
  })

  it('truncates a long snippet without splitting code points', async () => {
    const longDescription = `${'前'.repeat(30)}订单${'后'.repeat(60)}`
    const record = entry('project-1', 'project', {
      name: '结算平台',
      startDate: '2024-01',
      description: longDescription,
    })
    const library = newInfoLibrary({ entries: [record] })

    const result = await searchInfoEntries(library.deps, { keyword: '订单' })
    const snippet = result.hits[0]?.snippet ?? ''
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('订单')
    expect([...snippet].length).toBeLessThanOrEqual(61)
  })

  it('returns no hits for a keyword nothing contains', async () => {
    const library = newInfoLibrary({ entries: [entry('project-1', 'project', { name: '订单中台', startDate: '2024-01' })] })
    const result = await searchInfoEntries(library.deps, { keyword: '量子计算' })
    expect(result.hits).toEqual([])
  })

  it('rejects a blank, too long or wrongly typed query', async () => {
    const library = newInfoLibrary()

    await expectDomainErrorAsync(
      searchInfoEntries(library.deps, { keyword: '   ' }),
      'blankRequiredField',
    )
    await expectDomainErrorAsync(
      searchInfoEntries(library.deps, { keyword: 'a'.repeat(SEARCH_KEYWORD_MAX_LENGTH + 1) }),
      'fieldTooLong',
    )
    await expectDomainErrorAsync(
      searchInfoEntries(library.deps, {
        keyword: 'x',
        moduleKinds: ['bogus' as never],
      }),
      'invalidFieldValue',
    )
  })

  it('does not return an entry whose fields are empty', async () => {
    const entryWithoutText = infoEntryFixture({
      id: 'skill-1',
      moduleKind: 'skill',
      fields: validRawFields('skill'),
    })
    const library = newInfoLibrary({ entries: [entryWithoutText] })
    const result = await searchInfoEntries(library.deps, { keyword: '不存在' })
    expect(result.hits).toEqual([])
    expect(asInfoEntryId('skill-1')).toBe(entryWithoutText.id)
  })
})
