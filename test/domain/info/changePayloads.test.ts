/**
 * @file changePayloads.test
 * @description The change-record payload contract: what a use case serializes,
 * the undo side reads back unchanged, and a payload carrying a key the contract
 * does not know is refused instead of being silently rebuilt without it — the
 * way an undo would otherwise drop a field the domain grew.
 */

import { describe, expect, it } from 'vitest'

import type { InfoEntry } from '../../../src/domain/info/InfoEntry'
import {
  parseCustomModulePayload,
  parseDeletedModulePayload,
  parseInfoEntryPayload,
  parseModuleUpdatePayload,
  parseOrderMappings,
  serializeCustomModulePayload,
  serializeDeletedModulePayload,
  serializeInfoEntryPayload,
  serializeModuleUpdatePayload,
  serializeOrderMappings,
} from '../../../src/domain/info/changePayloads'
import type { InfoModuleKind } from '../../../src/domain/info/InfoModuleKind'
import {
  customModuleFixture,
  infoEntryFixture,
  validRawFields,
} from '../../support/infoFixtures'

function entryOfKind(moduleKind: InfoModuleKind): InfoEntry {
  return infoEntryFixture({
    id: `entry-${moduleKind}`,
    moduleKind,
    fields: validRawFields(moduleKind as Exclude<InfoModuleKind, 'custom'>),
  })
}

const ENTRY_KINDS = [
  'personal',
  'education',
  'internship',
  'project',
  'skill',
  'award',
  'jobIntent',
  'selfEvaluation',
] as const satisfies readonly InfoModuleKind[]

describe('entry payload', () => {
  it('round-trips an entry of every built-in kind', () => {
    for (const moduleKind of ENTRY_KINDS) {
      const entry = entryOfKind(moduleKind)
      expect(parseInfoEntryPayload(JSON.parse(serializeInfoEntryPayload(entry)))).toEqual(entry)
    }
  })

  it('round-trips a custom entry and its module reference', () => {
    const module = customModuleFixture()
    const entry = infoEntryFixture({
      id: 'entry-custom',
      moduleKind: 'custom',
      fields: { title: '获奖记录', [module.fields[0]!.key]: '2023', [module.fields[1]!.key]: '连续三年' },
      customModule: module,
    })
    expect(parseInfoEntryPayload(JSON.parse(serializeInfoEntryPayload(entry)))).toEqual(entry)
  })

  it('refuses a payload with a key the contract does not know', () => {
    const entry = entryOfKind('skill')
    const drifted = { ...JSON.parse(serializeInfoEntryPayload(entry)), summary: '新字段' }
    expect(() => parseInfoEntryPayload(drifted)).toThrow(/unknown keys/)
  })
})

describe('module payload', () => {
  it('round-trips a module definition', () => {
    const module = customModuleFixture()
    expect(parseCustomModulePayload(JSON.parse(serializeCustomModulePayload(module)))).toEqual(
      module,
    )
  })

  it('refuses a payload with a key the contract does not know', () => {
    const module = customModuleFixture()
    const drifted = { ...JSON.parse(serializeCustomModulePayload(module)), icon: 'star' }
    expect(() => parseCustomModulePayload(drifted)).toThrow(/unknown keys/)
  })
})

describe('module update payload', () => {
  it('round-trips the definition and the cleared values', () => {
    const module = customModuleFixture()
    const cleared = [
      {
        entryId: infoEntryFixture({
          id: 'entry-cleared',
          moduleKind: 'custom',
          fields: { title: '获奖记录', [module.fields[0]!.key]: '2023', [module.fields[1]!.key]: '连续三年' },
          customModule: module,
        }).id,
        fieldKey: module.fields[0]!.key,
        value: '2023',
      },
    ]
    const parsed = parseModuleUpdatePayload(
      JSON.parse(serializeModuleUpdatePayload(module, cleared)),
    )
    expect(parsed.module).toEqual(module)
    expect(parsed.clearedValues).toEqual(cleared)
  })

  it('refuses a payload with a key the contract does not know', () => {
    const module = customModuleFixture()
    const drifted = { ...JSON.parse(serializeModuleUpdatePayload(module, [])), clearedCount: 1 }
    expect(() => parseModuleUpdatePayload(drifted)).toThrow(/unknown keys/)
  })
})

describe('deleted module payload', () => {
  it('round-trips the module and its entries', () => {
    const module = customModuleFixture()
    const entries = [
      infoEntryFixture({
        id: 'entry-in-module',
        moduleKind: 'custom',
        fields: { title: '获奖记录', [module.fields[0]!.key]: '2023', [module.fields[1]!.key]: '连续三年' },
        customModule: module,
      }),
    ]
    const parsed = parseDeletedModulePayload(JSON.parse(serializeDeletedModulePayload(module, entries)))
    expect(parsed.module).toEqual(module)
    expect(parsed.entries).toEqual(entries)
  })

  it('refuses a payload with a key the contract does not know', () => {
    const module = customModuleFixture()
    const drifted = { ...JSON.parse(serializeDeletedModulePayload(module, [])), entryCount: 1 }
    expect(() => parseDeletedModulePayload(drifted)).toThrow(/unknown keys/)
  })
})

describe('order mappings payload', () => {
  it('round-trips the mappings', () => {
    const mappings = [
      { id: 'entry-2', sortOrder: 1 },
      { id: 'entry-1', sortOrder: 2 },
    ]
    expect(parseOrderMappings(JSON.parse(serializeOrderMappings(mappings)))).toEqual(mappings)
  })

  it('refuses a mapping with a key the contract does not know', () => {
    expect(() =>
      parseOrderMappings([{ id: 'entry-1', sortOrder: 1, title: '额外字段' }]),
    ).toThrow(/unknown keys/)
  })
})
