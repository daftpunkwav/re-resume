/**
 * @file fixturesInfo.test
 * @description The preview library fixture is data the application will happily
 * load: every entry passes the same validation a user write goes through, every
 * module is represented, and the custom module references a definition that is
 * present.
 */

import { describe, expect, it } from 'vitest'

import { validateCustomModuleDefinition } from '../../../src/domain/info/CustomModule'
import { validateFieldValues } from '../../../src/domain/info/InfoFieldValue'
import { INFO_MODULE_KINDS } from '../../../src/domain/info/InfoModuleKind'
import { UNTITLED_ENTRY } from '../../../src/domain/info/InfoEntry'
import {
  PREVIEW_CERTIFICATE_MODULE,
  PREVIEW_INFO_CUSTOM_MODULES,
  PREVIEW_INFO_ENTRIES,
} from '../../../src/infrastructure/preview/fixtures.info'

interface PreviewFixtureRow {
  readonly id: string
  readonly moduleKind: (typeof INFO_MODULE_KINDS)[number]
  readonly title: string
  readonly sortOrder: number
}

function rowsOfEntries(): readonly PreviewFixtureRow[] {
  return PREVIEW_INFO_ENTRIES.map((entry) => ({
    id: entry.id,
    moduleKind: entry.moduleKind,
    title: entry.title,
    sortOrder: entry.sortOrder,
  }))
}

describe('preview information fixtures', () => {
  it('validates every entry against its module schema', () => {
    for (const entry of PREVIEW_INFO_ENTRIES) {
      const customModule =
        entry.moduleKind === 'custom'
          ? PREVIEW_INFO_CUSTOM_MODULES.find((module) => module.id === entry.customModuleId) ?? null
          : null
      expect(() => validateFieldValues(entry.moduleKind, customModule, entry.fields)).not.toThrow()
    }
  })

  it('covers all nine modules with more than one entry in several of them', () => {
    const kinds = new Set(rowsOfEntries().map((row) => row.moduleKind))
    expect([...kinds].sort()).toEqual([...INFO_MODULE_KINDS].sort())

    const counts = new Map<string, number>()
    for (const row of rowsOfEntries()) counts.set(row.moduleKind, (counts.get(row.moduleKind) ?? 0) + 1)
    expect(counts.get('personal')).toBe(1)
    expect(counts.get('education')).toBeGreaterThan(1)
    expect(counts.get('internship')).toBeGreaterThan(1)
    expect(counts.get('project')).toBeGreaterThan(1)
    expect(counts.get('custom')).toBeGreaterThan(1)
  })

  it('gives every entry a real derived title and a dense order inside its module', () => {
    const titles = PREVIEW_INFO_ENTRIES.map((entry) => entry.title)
    expect(titles).not.toContain(UNTITLED_ENTRY)
    expect(new Set(titles).size).toBe(titles.length)

    for (const kind of INFO_MODULE_KINDS) {
      const orders = PREVIEW_INFO_ENTRIES.filter((entry) => entry.moduleKind === kind).map(
        (entry) => entry.sortOrder,
      )
      expect(orders).toEqual(Array.from({ length: orders.length }, (_, index) => index + 1))
    }
  })

  it('uses unique identifiers for entries and modules', () => {
    const entryIds = PREVIEW_INFO_ENTRIES.map((entry) => entry.id)
    expect(new Set(entryIds).size).toBe(entryIds.length)
    const moduleIds = PREVIEW_INFO_CUSTOM_MODULES.map((module) => module.id)
    expect(new Set(moduleIds).size).toBe(moduleIds.length)
  })

  it('declares a valid custom module that every custom entry names', () => {
    expect(() => validateCustomModuleDefinition(PREVIEW_CERTIFICATE_MODULE)).not.toThrow()
    expect(PREVIEW_CERTIFICATE_MODULE.fields.length).toBeGreaterThan(0)
    const declaredKeys = new Set<string>(
      PREVIEW_CERTIFICATE_MODULE.fields.map((field) => field.key),
    )
    for (const entry of PREVIEW_INFO_ENTRIES) {
      if (entry.moduleKind !== 'custom') continue
      expect(entry.customModuleId).toBe(PREVIEW_CERTIFICATE_MODULE.id)
      for (const key of Object.keys(entry.fields)) {
        expect(key === 'title' || declaredKeys.has(key)).toBe(true)
      }
    }
  })
})
