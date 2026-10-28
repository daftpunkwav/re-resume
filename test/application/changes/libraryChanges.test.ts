/**
 * @file libraryChanges.test
 * @description Undo against the real SQLite information repositories: the inverse
 * writer replays the recorded before state, and the undo use case enforces its
 * ordering rules. Each test drives the public use cases to produce the record, so
 * the payload shapes under test are exactly the ones the application writes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createInfoEntry } from '../../../src/application/info/createInfoEntry'
import { createCustomModule } from '../../../src/application/info/createCustomModule'
import { deleteCustomModule } from '../../../src/application/info/deleteCustomModule'
import { deleteInfoEntry } from '../../../src/application/info/deleteInfoEntry'
import { reorderInfoEntries } from '../../../src/application/info/reorderInfoEntries'
import { updateCustomModule } from '../../../src/application/info/updateCustomModule'
import { updateInfoEntry } from '../../../src/application/info/updateInfoEntry'
import { createLibraryChangesService } from '../../../src/bootstrap/wiring/changes'
import { isDomainError } from '../../../src/domain/shared/DomainError'
import type { InfoLibraryDeps } from '../../../src/application/info/library'
import type { ChangeRecord } from '../../../src/domain/changes/ChangeRecord'
import {
  asAgentRunId,
  asChangeRecordId,
  asCustomModuleId,
} from '../../../src/domain/shared/branded-id'
import { SqliteChangeRecordRepository } from '../../../src/infrastructure/persistence/info/SqliteChangeRecordRepository'
import { SqliteCustomModuleRepository } from '../../../src/infrastructure/persistence/info/SqliteCustomModuleRepository'
import { SqliteInfoEntryRepository } from '../../../src/infrastructure/persistence/info/SqliteInfoEntryRepository'
import { InMemoryEntryReferenceQuery } from '../../../src/infrastructure/preview/inMemoryInfoRepositories'
import { customFieldsFixture, validRawFields } from '../../support/infoFixtures'
import { InMemoryResumeRepository } from '../../../src/infrastructure/preview/inMemoryResumeRepository'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import {
  applyInfoSchema,
  openTestDatabase,
  type TestDatabase,
} from '../../support/nodeSqliteDatabase'

let database: TestDatabase
let deps: InfoLibraryDeps
let changes: SqliteChangeRecordRepository
let clock: FixedClock
let undoService: ReturnType<typeof createLibraryChangesService>

beforeEach(() => {
  database = openTestDatabase()
  applyInfoSchema(database)
  const customModules = new SqliteCustomModuleRepository(database)
  const entries = new SqliteInfoEntryRepository(database, customModules)
  changes = new SqliteChangeRecordRepository(database)
  clock = new FixedClock()
  deps = {
    entries,
    customModules,
    references: new InMemoryEntryReferenceQuery(),
    clock,
    ids: new SequentialIdGenerator('undo'),
  }
  undoService = createLibraryChangesService({
    changes,
    entries,
    customModules,
    resumes: new InMemoryResumeRepository(clock),
    clock,
  })
})

afterEach(() => {
  database.closeAndRemove()
})

async function undo(record: ChangeRecord): Promise<void> {
  await undoService.undo({ changeId: record.id })
}

function expectDomainCode(error: unknown, code: string): void {
  expect(isDomainError(error)).toBe(true)
  expect((error as { code: string }).code).toBe(code)
}

describe('undoing a recorded library write', () => {
  it('removes the row a creation added', async () => {
    const created = await createInfoEntry(deps, {
      moduleKind: 'project',
      fields: validRawFields('project', { name: '订单中台' }),
      origin: 'user',
    })

    await undo(created.change)

    await expect(deps.entries.findById(created.entry.id)).resolves.toBeNull()
    const record = await changes.findById(created.change.id)
    expect(record?.undoneAt).not.toBeNull()
  })

  it('restores the previous field values of an update', async () => {
    const created = await createInfoEntry(deps, {
      moduleKind: 'project',
      fields: validRawFields('project', { name: '订单中台' }),
      origin: 'user',
    })
    const updated = await updateInfoEntry(deps, {
      entryId: created.entry.id,
      fields: validRawFields('project', { name: '订单中台', description: '新的描述' }),
      origin: 'user',
    })

    await undo(updated.change)

    const restored = await deps.entries.findById(created.entry.id)
    expect(restored?.fields).toEqual(created.entry.fields)
    expect(restored?.title).toBe('订单中台')
  })

  it('restores a deleted entry with its identifier, fields and order', async () => {
    const created = await createInfoEntry(deps, {
      moduleKind: 'project',
      fields: validRawFields('project', { name: '订单中台' }),
      origin: 'user',
    })
    const second = await createInfoEntry(deps, {
      moduleKind: 'project',
      fields: validRawFields('project', { name: '增长平台' }),
      origin: 'user',
    })
    const deleted = await deleteInfoEntry(deps, {
      entryId: second.entry.id,
      confirmReferenced: false,
      origin: 'user',
    })

    await undo(deleted.change)

    const restored = await deps.entries.findById(second.entry.id)
    expect(restored).toMatchObject({
      id: second.entry.id,
      sortOrder: 2,
      title: '增长平台',
    })
    const entries = await deps.entries.listByModule('project', null)
    expect(entries.map((entry) => entry.id)).toEqual([created.entry.id, second.entry.id])
  })

  it('restores a deleted custom module together with its entries', async () => {
    const module = await createCustomModule(deps, {
      name: '证书',
      fields: customFieldsFixture().map((field) => ({
        label: field.label,
        type: field.type,
        required: field.required,
        maxLength: field.maxLength,
      })),
      origin: 'user',
    })
    const entry = await createInfoEntry(deps, {
      moduleKind: 'custom',
      customModuleId: module.module.id,
      fields: { title: 'AWS 认证', [module.module.fields[0]!.key]: 'AWS 认证' },
      origin: 'user',
    })
    const deleted = await deleteCustomModule(deps, {
      moduleId: module.module.id,
      confirmEntries: true,
      origin: 'user',
    })

    await undo(deleted.change)

    await expect(deps.customModules.findById(module.module.id)).resolves.toMatchObject({
      id: module.module.id,
      name: '证书',
    })
    await expect(deps.entries.findById(entry.entry.id)).resolves.toMatchObject({
      id: entry.entry.id,
      customModuleId: module.module.id,
    })
  })

  it('restores the values a module update cleared and the removed field', async () => {
    const module = await createCustomModule(deps, {
      name: '证书',
      fields: customFieldsFixture().map((field) => ({
        label: field.label,
        type: field.type,
        required: field.required,
        maxLength: field.maxLength,
      })),
      origin: 'user',
    })
    const textKey = module.module.fields[0]!.key
    const entry = await createInfoEntry(deps, {
      moduleKind: 'custom',
      customModuleId: module.module.id,
      fields: { title: 'AWS 认证', [textKey]: 'AWS 认证' },
      origin: 'user',
    })
    const updated = await updateCustomModule(deps, {
      moduleId: module.module.id,
      fields: [
        {
          key: module.module.fields[1]!.key,
          label: '说明',
          type: 'textarea',
          required: false,
          maxLength: 600,
        },
      ],
      confirmValuesLoss: true,
      origin: 'user',
    })

    await undo(updated.change)

    const restoredModule = await deps.customModules.findById(module.module.id)
    expect(restoredModule?.fields.map((field) => field.key)).toContain(textKey)
    const restoredEntry = await deps.entries.findById(entry.entry.id)
    expect(restoredEntry?.fields[textKey]).toBe('AWS 认证')
  })

  it('restores the order a reorder changed', async () => {
    const first = await createInfoEntry(deps, {
      moduleKind: 'skill',
      fields: validRawFields('skill', { name: 'TypeScript' }),
      origin: 'user',
    })
    const second = await createInfoEntry(deps, {
      moduleKind: 'skill',
      fields: validRawFields('skill', { name: 'Node.js' }),
      origin: 'user',
    })
    const reordered = await reorderInfoEntries(deps, {
      moduleKind: 'skill',
      orderedEntryIds: [second.entry.id, first.entry.id],
      origin: 'user',
    })

    await undo(reordered.change)

    const entries = await deps.entries.listByModule('skill', null)
    expect(entries.map((entry) => [entry.id, entry.sortOrder])).toEqual([
      [first.entry.id, 1],
      [second.entry.id, 2],
    ])
  })

  it('refuses the second undo of the same change', async () => {
    const created = await createInfoEntry(deps, {
      moduleKind: 'skill',
      fields: validRawFields('skill', { name: 'TypeScript' }),
      origin: 'user',
    })
    await undo(created.change)

    await expect(undo(created.change)).rejects.toSatisfy((error: unknown) => {
      expectDomainCode(error, 'changeAlreadyUndone')
      return true
    })
  })

  it('refuses an out-of-order undo of the same entity', async () => {
    const created = await createInfoEntry(deps, {
      moduleKind: 'skill',
      fields: validRawFields('skill', { name: 'TypeScript' }),
      origin: 'user',
    })
    await updateInfoEntry(deps, {
      entryId: created.entry.id,
      fields: validRawFields('skill', { name: 'TypeScript', notes: '更新后的说明' }),
      origin: 'user',
    })

    await expect(undo(created.change)).rejects.toSatisfy((error: unknown) => {
      expectDomainCode(error, 'changeOutOfOrder')
      return true
    })
  })

  it('reports a record whose before payload cannot be read back', async () => {
    await changes.append({
      id: asChangeRecordId('corrupt-change'),
      scope: 'library',
      entity: 'infoEntry',
      entityId: 'missing-entry',
      op: 'infoEntry.delete',
      beforeJson: '{"id":42}',
      afterJson: null,
      origin: 'user',
      runId: null,
      conversationId: null,
      label: '损坏的变更',
      undoneAt: null,
      createdAt: clock.now(),
    })

    await expect(undoService.undo({ changeId: asChangeRecordId('corrupt-change') })).rejects.toThrow(
      /无法解析/,
    )
  })
})

describe('undoing a module creation', () => {
  it('removes the module and the entries that were added after it', async () => {
    const module = await createCustomModule(deps, {
      name: '证书',
      fields: customFieldsFixture().map((field) => ({
        label: field.label,
        type: field.type,
        required: field.required,
        maxLength: field.maxLength,
      })),
      origin: 'user',
    })
    const entry = await createInfoEntry(deps, {
      moduleKind: 'custom',
      customModuleId: asCustomModuleId(module.module.id),
      fields: { title: 'AWS 认证', [module.module.fields[0]!.key]: 'AWS 认证' },
      origin: 'user',
    })

    await undo(module.change)

    await expect(deps.customModules.findById(module.module.id)).resolves.toBeNull()
    await expect(deps.entries.findById(entry.entry.id)).resolves.toBeNull()
  })
})

describe('undoing a tool-written entry', () => {
  it('reverses the row an agent write added', async () => {
    const runId = asAgentRunId('run-1')
    const created = await createInfoEntry(deps, {
      moduleKind: 'project',
      fields: validRawFields('project', { name: '订单中台' }),
      origin: 'agent',
      sourceRunId: runId,
    })

    await undo(created.change)

    await expect(deps.entries.findById(created.entry.id)).resolves.toBeNull()
    const record = await changes.findById(created.change.id)
    expect(record?.origin).toBe('agent')
    expect(record?.runId).toBe(runId)
  })
})
