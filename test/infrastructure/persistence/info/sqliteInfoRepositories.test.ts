/**
 * @file sqliteInfoRepositories.test
 * @description Contract tests for the three information-library repositories
 * against a real SQLite file: round trips, the column contract, the order index,
 * the cascade, the reorder two-pass rewrite and the change-record transaction.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ChangeRecord } from '../../../../src/domain/changes/ChangeRecord'
import type { CustomModuleDefinition } from '../../../../src/domain/info/CustomModule'
import type { InfoEntry } from '../../../../src/domain/info/InfoEntry'
import {
  asChangeRecordId,
  asCustomFieldKey,
  asCustomModuleId,
  asInfoEntryId,
} from '../../../../src/domain/shared/branded-id'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import { RowMappingError, readJsonEnvelope, writeJsonEnvelope } from '../../../../src/infrastructure/persistence/JsonEnvelope'
import { SqliteChangeRecordRepository } from '../../../../src/infrastructure/persistence/info/SqliteChangeRecordRepository'
import { SqliteCustomModuleRepository } from '../../../../src/infrastructure/persistence/info/SqliteCustomModuleRepository'
import { SqliteInfoEntryRepository } from '../../../../src/infrastructure/persistence/info/SqliteInfoEntryRepository'
import {
  customModuleFixture,
  FIXTURE_TIME,
  infoEntryFixture,
  validRawFields,
} from '../../../support/infoFixtures'
import {
  applyInfoSchema,
  openTestDatabase,
  type TestDatabase,
} from '../../../support/nodeSqliteDatabase'

const MODULE = customModuleFixture({ id: asCustomModuleId('module-certificates') })

let database: TestDatabase
let entries: SqliteInfoEntryRepository
let modules: SqliteCustomModuleRepository
let changes: SqliteChangeRecordRepository
let changeCounter = 0

beforeEach(() => {
  database = openTestDatabase()
  applyInfoSchema(database)
  modules = new SqliteCustomModuleRepository(database)
  entries = new SqliteInfoEntryRepository(database, modules)
  changes = new SqliteChangeRecordRepository(database)
  changeCounter = 0
})

afterEach(() => {
  database.closeAndRemove()
})

function change(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  changeCounter += 1
  return {
    id: asChangeRecordId(`change-${changeCounter.toString()}`),
    scope: 'library',
    entity: 'infoEntry',
    entityId: 'entry-1',
    op: 'infoEntry.create',
    beforeJson: null,
    afterJson: '{"id":"entry-1"}',
    origin: 'user',
    runId: null,
    conversationId: null,
    label: '测试变更',
    undoneAt: null,
    createdAt: FIXTURE_TIME,
    ...overrides,
  }
}

function projectEntry(id: string, sortOrder: number, overrides: Partial<InfoEntry> = {}): InfoEntry {
  return infoEntryFixture({
    id,
    moduleKind: 'project',
    fields: validRawFields('project', { name: `项目${id}` }),
    sortOrder,
    ...overrides,
  })
}

function customEntry(
  id: string,
  sortOrder = 1,
  values: Readonly<Record<string, string>> = {},
): InfoEntry {
  return infoEntryFixture({
    id,
    moduleKind: 'custom',
    customModule: MODULE,
    fields: { title: id, f_11111111: '证书', ...values },
    sortOrder,
  })
}

async function insertModule(module: CustomModuleDefinition = MODULE): Promise<void> {
  await modules.insert(module, change({ entity: 'customModule', entityId: module.id, op: 'customModule.create' }))
}

function countRows(table: 'info_entry' | 'custom_module' | 'change_record'): number {
  const row = database.selectOne<{ readonly count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
  return row?.count ?? -1
}

describe('SqliteInfoEntryRepository', () => {
  it('round-trips an entry and reads it back by module', async () => {
    const entry = projectEntry('entry-1', 1)
    await entries.insert(entry, change())

    await expect(entries.findById(entry.id)).resolves.toEqual(entry)
    await expect(entries.listAll()).resolves.toEqual([entry])
    await expect(entries.listByModule('project', null)).resolves.toEqual([entry])
    await expect(entries.listByModule('award', null)).resolves.toEqual([])
    await expect(entries.countByModule('project', null)).resolves.toBe(1)
    expect(countRows('info_entry')).toBe(1)
  })

  it('updates an entry in place and keeps its identity', async () => {
    const entry = projectEntry('entry-1', 1)
    await entries.insert(entry, change())
    const updated: InfoEntry = {
      ...entry,
      title: '订单中台二期',
      fields: {
        ...entry.fields,
        description: '新的描述',
      },
      updatedAt: parseDateTime('2026-02-01T00:00:00.000Z')!,
    }

    await entries.update(updated, change({ op: 'infoEntry.update' }))

    await expect(entries.findById(entry.id)).resolves.toEqual(updated)
    expect(countRows('info_entry')).toBe(1)
  })

  it('stores the fields inside the JSON envelope', async () => {
    const entry = projectEntry('entry-1', 1)
    await entries.insert(entry, change())

    const raw = database.selectOne<{ readonly fields_json: unknown }>(
      'SELECT fields_json FROM info_entry WHERE id = $1',
      ['entry-1'],
    )
    expect(readJsonEnvelope(raw?.fields_json, 'fields_json')).toEqual(entry.fields)
  })

  it('reports a stored field record from another envelope version', async () => {
    const entry = projectEntry('entry-1', 1)
    await entries.insert(entry, change())
    database.exec(
      `UPDATE info_entry SET fields_json = '{"v":2,"data":{}}' WHERE id = 'entry-1'`,
    )

    await expect(entries.findById(entry.id)).rejects.toBeInstanceOf(RowMappingError)
  })

  it('reports stored fields that violate the module schema', async () => {
    const entry = projectEntry('entry-1', 1)
    await entries.insert(entry, change())
    database.exec(
      `UPDATE info_entry SET fields_json = '${writeJsonEnvelope({ name: 'x', startDate: 'present' })}' WHERE id = 'entry-1'`,
    )

    await expect(entries.findById(entry.id)).rejects.toBeInstanceOf(RowMappingError)
  })

  it('refuses a duplicate sort order inside one module', async () => {
    await entries.insert(projectEntry('entry-1', 1), change())
    await expect(entries.insert(projectEntry('entry-2', 1), change())).rejects.toThrow()

    // The failed insert must not leave its change record behind.
    expect(countRows('change_record')).toBe(1)
    await expect(entries.listByModule('project', null)).resolves.toHaveLength(1)
  })

  it('allows the same sort order in two different modules', async () => {
    await entries.insert(projectEntry('entry-1', 1), change())
    await entries.insert(
      infoEntryFixture({
        id: 'entry-2',
        moduleKind: 'award',
        fields: validRawFields('award'),
        sortOrder: 1,
      }),
      change(),
    )
    await expect(entries.listAll()).resolves.toHaveLength(2)
  })

  it('enforces the custom module association in the schema', async () => {
    await insertModule()
    const customWithoutModule: InfoEntry = {
      ...projectEntry('entry-1', 1),
      moduleKind: 'custom',
      customModuleId: null,
    }
    await expect(entries.insert(customWithoutModule, change())).rejects.toThrow()

    const builtInWithModule: InfoEntry = {
      ...projectEntry('entry-2', 1),
      customModuleId: MODULE.id,
    }
    await expect(entries.insert(builtInWithModule, change())).rejects.toThrow()
  })

  it('refuses an entry that names a missing custom module', async () => {
    const orphan = customEntry('entry-1')
    const missingModuleEntry: InfoEntry = {
      ...orphan,
      customModuleId: asCustomModuleId('module-missing'),
    }
    // The entry id is fine; only the foreign key is unbalanced.
    await expect(entries.insert(missingModuleEntry, change())).rejects.toThrow()
  })

  it('reports an update of a row that disappeared', async () => {
    const entry = projectEntry('entry-1', 1)
    await expect(entries.update(entry, change())).rejects.toThrow(/disappeared/)
    expect(countRows('change_record')).toBe(0)
  })

  it('reports a delete of a row that disappeared', async () => {
    await expect(entries.delete(asInfoEntryId('missing'), change())).rejects.toThrow(/disappeared/)
    expect(countRows('change_record')).toBe(0)
  })

  it('rewrites the order densely even when every position collides', async () => {
    for (const [index, id] of ['entry-1', 'entry-2', 'entry-3'].entries()) {
      await entries.insert(projectEntry(id, index + 1), change())
    }
    const reorderChange = change({
      op: 'infoEntry.reorder',
      beforeJson: '[]',
      afterJson: '[]',
    })

    await entries.reorder(
      'project',
      null,
      [asInfoEntryId('entry-3'), asInfoEntryId('entry-2'), asInfoEntryId('entry-1')],
      reorderChange,
    )

    const stored = await entries.listByModule('project', null)
    expect(stored.map((entry) => [entry.id, entry.sortOrder])).toEqual([
      ['entry-3', 1],
      ['entry-2', 2],
      ['entry-1', 3],
    ])
    await expect(changes.findById(reorderChange.id)).resolves.toEqual(reorderChange)
  })

  it('refuses a reorder whose identifier set does not match the module', async () => {
    await entries.insert(projectEntry('entry-1', 1), change())
    await entries.insert(projectEntry('entry-2', 2), change())

    await expect(
      entries.reorder('project', null, [asInfoEntryId('entry-2')], change()),
    ).rejects.toThrow(/Cannot rewrite the sort order/)
    await expect(
      entries.reorder('project', null, [asInfoEntryId('entry-1'), asInfoEntryId('missing')], change()),
    ).rejects.toThrow(/Cannot rewrite the sort order/)
    await expect(
      entries.reorder(
        'project',
        null,
        [asInfoEntryId('entry-1'), asInfoEntryId('entry-1')],
        change(),
      ),
    ).rejects.toThrow(/listed twice/)

    const stored = await entries.listByModule('project', null)
    expect(stored.map((entry) => entry.sortOrder)).toEqual([1, 2])
  })

  it('commits the entry and its change record in one transaction', async () => {
    const record = change({ label: '新增项目经历：订单中台' })
    await entries.insert(projectEntry('entry-1', 1), record)

    const stored = await changes.findById(record.id)
    expect(stored).toEqual(record)
    await expect(changes.listRecent(10)).resolves.toEqual([record])
    await expect(changes.latestLiveForEntity('infoEntry', 'entry-1')).resolves.toEqual(record)
  })

  it('stamps an undone change in the same transaction as the inverse write', async () => {
    const created = change({ label: '新增' })
    const entry = projectEntry('entry-1', 1)
    await entries.insert(entry, created)
    const undoneAt = parseDateTime('2026-05-01T00:00:00.000Z')!

    // The undo path passes the record being undone with its stamp: no second
    // record is appended, the original one is stamped.
    await entries.delete(entry.id, { ...created, undoneAt })

    await expect(entries.findById(entry.id)).resolves.toBeNull()
    const stored = await changes.findById(created.id)
    expect(stored?.undoneAt).toBe(undoneAt)
    expect(stored?.op).toBe('infoEntry.create')
    expect(countRows('change_record')).toBe(1)
  })

  it('keeps the foreign key check clean', async () => {
    await insertModule()
    await entries.insert(projectEntry('entry-1', 1), change())
    await entries.insert(customEntry('entry-2'), change())
    expect(database.selectOne('PRAGMA foreign_key_check')).toBeNull()
  })
})

describe('SqliteCustomModuleRepository', () => {
  it('round-trips a definition and keeps the field order', async () => {
    await insertModule()
    await expect(modules.findById(MODULE.id)).resolves.toEqual(MODULE)
    await expect(modules.listAll()).resolves.toEqual([MODULE])
  })

  it('stores the field list inside the JSON envelope', async () => {
    await insertModule()
    const raw = database.selectOne<{ readonly fields_json: unknown }>(
      'SELECT fields_json FROM custom_module WHERE id = $1',
      [MODULE.id],
    )
    expect(readJsonEnvelope(raw?.fields_json, 'fields_json')).toEqual(
      MODULE.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        maxLength: field.maxLength,
      })),
    )
  })

  it('reports a stored definition that violates the module contract', async () => {
    await insertModule()
    database.exec(
      `UPDATE custom_module SET fields_json = '{"v":2,"data":[]}' WHERE id = '${MODULE.id}'`,
    )
    await expect(modules.findById(MODULE.id)).rejects.toBeInstanceOf(RowMappingError)
  })

  it('clears the removed field values in the same transaction as the update', async () => {
    await insertModule()
    await entries.insert(customEntry('entry-1'), change())
    const updated: CustomModuleDefinition = {
      ...MODULE,
      fields: [MODULE.fields[0]!],
      updatedAt: parseDateTime('2026-02-01T00:00:00.000Z')!,
    }

    await modules.update(
      updated,
      [{ entryId: asInfoEntryId('entry-1'), fieldKey: asCustomFieldKey('f_22222222') }],
      change({ entity: 'customModule', entityId: MODULE.id, op: 'customModule.update' }),
    )

    await expect(modules.findById(MODULE.id)).resolves.toEqual(updated)
    const stored = await entries.findById(asInfoEntryId('entry-1'))
    expect(stored?.fields).not.toHaveProperty('f_22222222')
    expect(stored?.fields.f_11111111).toBe('证书')
    expect(stored?.updatedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('deletes the entries and the definition together', async () => {
    await insertModule()
    await entries.insert(customEntry('entry-1'), change())
    await entries.insert(customEntry('entry-2', 2), change())
    const snapshot = await entries.listByModule('custom', MODULE.id)

    await modules.delete(
      MODULE.id,
      snapshot,
      change({ entity: 'customModule', entityId: MODULE.id, op: 'customModule.delete' }),
    )

    await expect(modules.findById(MODULE.id)).resolves.toBeNull()
    await expect(entries.listByModule('custom', MODULE.id)).resolves.toEqual([])
    expect(countRows('change_record')).toBe(4)
  })

  it('restores a deleted definition and its entries with one stamped record', async () => {
    await insertModule()
    await entries.insert(customEntry('entry-1'), change())
    await entries.insert(customEntry('entry-2', 2), change())
    const snapshot = await entries.listByModule('custom', MODULE.id)
    const deletion = change({
      entity: 'customModule',
      entityId: MODULE.id,
      op: 'customModule.delete',
      beforeJson: JSON.stringify({ module: MODULE, entries: snapshot }),
    })
    await modules.delete(MODULE.id, snapshot, deletion)
    const recordCount = countRows('change_record')

    // The undo path reinserts the definition and its entries through `insert`,
    // and stamps the deletion record in the same transaction.
    const undoneAt = parseDateTime('2026-05-01T00:00:00.000Z')!
    await modules.insert(MODULE, { ...deletion, undoneAt }, snapshot)

    await expect(modules.findById(MODULE.id)).resolves.toEqual(MODULE)
    await expect(entries.listByModule('custom', MODULE.id)).resolves.toEqual(snapshot)
    const stored = await changes.findById(deletion.id)
    expect(stored?.undoneAt).toBe(undoneAt)
    expect(countRows('change_record')).toBe(recordCount)
  })

  it('writes a removed field value back on the undo path', async () => {
    await insertModule()
    await entries.insert(customEntry('entry-1', 1, { f_22222222: '说明' }), change())
    const updated: CustomModuleDefinition = {
      ...MODULE,
      fields: [MODULE.fields[0]!],
      updatedAt: parseDateTime('2026-02-01T00:00:00.000Z')!,
    }
    const updateChange = change({
      entity: 'customModule',
      entityId: MODULE.id,
      op: 'customModule.update',
    })
    await modules.update(
      updated,
      [{ entryId: asInfoEntryId('entry-1'), fieldKey: asCustomFieldKey('f_22222222') }],
      updateChange,
    )
    await expect(entries.findById(asInfoEntryId('entry-1'))).resolves.toMatchObject({
      fields: { f_11111111: '证书' },
    })
    const recordCount = countRows('change_record')

    const undoneAt = parseDateTime('2026-05-01T00:00:00.000Z')!
    await modules.update(
      MODULE,
      [
        {
          entryId: asInfoEntryId('entry-1'),
          fieldKey: asCustomFieldKey('f_22222222'),
          restoredValue: '说明',
        },
      ],
      { ...updateChange, undoneAt },
    )

    await expect(modules.findById(MODULE.id)).resolves.toEqual(MODULE)
    const restored = await entries.findById(asInfoEntryId('entry-1'))
    expect(restored?.fields.f_22222222).toBe('说明')
    const stored = await changes.findById(updateChange.id)
    expect(stored?.undoneAt).toBe(undoneAt)
    expect(countRows('change_record')).toBe(recordCount)
  })

  it('refuses a delete whose reported entries no longer match the cascade', async () => {
    await insertModule()
    await entries.insert(customEntry('entry-1'), change())
    const snapshot = await entries.listByModule('custom', MODULE.id)
    await entries.insert(customEntry('entry-2', 2), change())

    await expect(
      modules.delete(MODULE.id, snapshot, change({ entity: 'customModule', op: 'customModule.delete' })),
    ).rejects.toThrow(/faithful inverse/)

    // Rolled back: the module and both entries are still there.
    await expect(modules.findById(MODULE.id)).resolves.not.toBeNull()
    await expect(entries.listByModule('custom', MODULE.id)).resolves.toHaveLength(2)
  })

  it('rewrites the module order densely even when every position collides', async () => {
    const first = customModuleFixture({ id: asCustomModuleId('module-a'), name: 'A', sortOrder: 1 })
    const second = customModuleFixture({ id: asCustomModuleId('module-b'), name: 'B', sortOrder: 2 })
    await insertModule(first)
    await insertModule(second)

    await modules.reorder(
      [second.id, first.id],
      change({ entity: 'customModule', entityId: 'customModules', op: 'customModule.reorder' }),
    )

    const stored = await modules.listAll()
    expect(stored.map((module) => [module.id, module.sortOrder])).toEqual([
      ['module-b', 1],
      ['module-a', 2],
    ])
  })
})

describe('SqliteChangeRecordRepository', () => {
  it('appends and reads records newest first', async () => {
    const older = change({ createdAt: parseDateTime('2026-01-01T00:00:00.000Z')! })
    const newer = change({ createdAt: parseDateTime('2026-03-01T00:00:00.000Z')! })
    await changes.append(older)
    await changes.append(newer)

    await expect(changes.listRecent(10)).resolves.toEqual([newer, older])
    await expect(changes.listRecent(1)).resolves.toEqual([newer])
    await expect(changes.findById(older.id)).resolves.toEqual(older)
  })

  it('returns the newest live record of an entity and ignores undone ones', async () => {
    const undone = change({
      entityId: 'entry-1',
      createdAt: parseDateTime('2026-02-01T00:00:00.000Z')!,
    })
    const live = change({
      entityId: 'entry-1',
      createdAt: parseDateTime('2026-01-01T00:00:00.000Z')!,
    })
    const otherEntity = change({ entityId: 'entry-2' })
    await changes.append(undone)
    await changes.append(live)
    await changes.append(otherEntity)
    await changes.markUndone(undone.id, parseDateTime('2026-04-01T00:00:00.000Z')!)

    await expect(changes.latestLiveForEntity('infoEntry', 'entry-1')).resolves.toEqual(live)
    await expect(changes.latestLiveForEntity('infoEntry', 'entry-3')).resolves.toBeNull()
  })

  it('reports an unknown record when stamping it undone', async () => {
    await expect(
      changes.markUndone(asChangeRecordId('missing'), FIXTURE_TIME),
    ).rejects.toThrow(/disappeared/)
  })

  it('does not replace a record on append', async () => {
    const record = change()
    await changes.append(record)
    await expect(changes.append({ ...record, label: '替换' })).rejects.toThrow()
    await expect(changes.findById(record.id)).resolves.toEqual(record)
  })

  it('reads back the before and after payloads through the envelope', async () => {
    const record = change({
      beforeJson: JSON.stringify({ id: 'entry-1', sortOrder: 3 }),
      afterJson: JSON.stringify({ id: 'entry-1', sortOrder: 1 }),
      op: 'infoEntry.update',
    })
    await changes.append(record)
    await expect(changes.findById(record.id)).resolves.toEqual(record)
  })

  it('rejects a stored record from an envelope version this build does not know', async () => {
    const record = change()
    await changes.append(record)
    database.exec(
      `UPDATE change_record SET before_json = '{"v":9,"data":"x"}' WHERE id = '${record.id}'`,
    )
    await expect(changes.findById(record.id)).rejects.toBeInstanceOf(RowMappingError)
  })
})
