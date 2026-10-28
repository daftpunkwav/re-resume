/**
 * @file undoLibraryChange.test
 * @description The four undo rules and the inverse dispatch of the library
 * change log. The entity writer is a recording double: the use case owns the
 * ordering and the marker, the writer owns the row writes.
 */

import { describe, expect, it } from 'vitest'

import { undoLibraryChange } from '../../../src/application/changes/undoLibraryChange'
import type { LibraryChangeInverseWriter } from '../../../src/application/changes/undoLibraryChange'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { ChangeOp, ChangeRecord } from '../../../src/domain/changes/ChangeRecord'
import type { ChangeLogRepository } from '../../../src/domain/changes/ports/ChangeLogRepository'
import { asChangeRecordId, asConversationId } from '../../../src/domain/shared/branded-id'
import { FixedClock } from '../../support/fakeEnvironment'
import type { Clock } from '../../../src/domain/shared/Clock'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime
const LATER: DateTime = parseDateTime('2026-01-01T00:00:05.000Z') as DateTime

function aRecord(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    id: asChangeRecordId('change-1'),
    scope: 'library',
    entity: 'infoEntry',
    entityId: 'entry-1',
    op: 'infoEntry.create',
    beforeJson: null,
    afterJson: '{"title":"订单中台"}',
    origin: 'user',
    runId: null,
    conversationId: asConversationId('conversation-1'),
    label: '新增项目经历：订单中台',
    undoneAt: null,
    createdAt: AT,
    ...overrides,
  }
}

class FakeChangeLog implements ChangeLogRepository {
  readonly rows = new Map<string, ChangeRecord>()
  readonly calls: string[] = []

  async findById(id: ChangeRecord['id']): Promise<ChangeRecord | null> {
    return this.rows.get(id) ?? null
  }

  async latestLiveForEntity(entity: string, entityId: string): Promise<ChangeRecord | null> {
    const live = [...this.rows.values()]
      .filter(
        (record) =>
          record.entity === entity && record.entityId === entityId && record.undoneAt === null,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return live.at(-1) ?? null
  }

  async listRecent(limit: number): Promise<readonly ChangeRecord[]> {
    return [...this.rows.values()].slice(0, limit)
  }

  async append(record: ChangeRecord): Promise<void> {
    this.rows.set(record.id, record)
  }

  async markUndone(id: ChangeRecord['id'], undoneAt: DateTime): Promise<void> {
    this.calls.push('markUndone')
    const record = this.rows.get(id)
    if (record !== undefined) this.rows.set(id, { ...record, undoneAt })
  }
}

class RecordingWriter implements LibraryChangeInverseWriter {
  readonly calls: string[] = []

  async deleteEntity(entity: string, entityId: string): Promise<void> {
    this.calls.push(`delete:${entity}:${entityId}`)
  }

  async restoreEntity(entity: string, entityId: string, beforeJson: string): Promise<void> {
    this.calls.push(`restore:${entity}:${entityId}:${beforeJson}`)
  }

  async restoreCustomModule(beforeJson: string): Promise<void> {
    this.calls.push(`module:${beforeJson}`)
  }

  async restoreEntityOrder(record: ChangeRecord): Promise<void> {
    this.calls.push(`order:${record.entityId}`)
  }
}

interface Bed {
  readonly changes: FakeChangeLog
  readonly writer: RecordingWriter
  readonly clock: FixedClock
}

function createBed(): Bed {
  return { changes: new FakeChangeLog(), writer: new RecordingWriter(), clock: new FixedClock() }
}

function deps(bed: Bed, clock: Clock = bed.clock) {
  return { changes: bed.changes, inverse: bed.writer, clock }
}

describe('undoLibraryChange', () => {
  it('reverses the newest live record and stamps the undo instant', async () => {
    const bed = createBed()
    const record = aRecord()
    await bed.changes.append(record)

    const undone = await undoLibraryChange(deps(bed), { changeId: record.id })

    expect(bed.writer.calls).toEqual(['delete:infoEntry:entry-1'])
    expect(undone.undoneAt).toBe('2026-01-01T00:00:00.000Z')
    // The inverse runs before the marker: a completed stamp over unapplied data
    // would hide that the data is still changed.
    expect(bed.changes.calls).toEqual(['markUndone'])
    expect((await bed.changes.findById(record.id))?.undoneAt).not.toBeNull()
  })

  it('reports an unknown record', async () => {
    const bed = createBed()
    await expect(
      undoLibraryChange(deps(bed), { changeId: asChangeRecordId('missing') }),
    ).rejects.toMatchObject({ code: 'changeNotFound' })
    expect(bed.writer.calls).toEqual([])
  })

  it('refuses a record that is already undone', async () => {
    const bed = createBed()
    const record = aRecord({ undoneAt: LATER })
    await bed.changes.append(record)
    await expect(
      undoLibraryChange(deps(bed), { changeId: record.id }),
    ).rejects.toMatchObject({ code: 'changeAlreadyUndone' })
    expect(bed.writer.calls).toEqual([])
  })

  it('refuses a record when a newer live record exists for the same entity', async () => {
    const bed = createBed()
    const older = aRecord()
    const newer = aRecord({ id: asChangeRecordId('change-2'), createdAt: LATER })
    await bed.changes.append(older)
    await bed.changes.append(newer)

    await expect(
      undoLibraryChange(deps(bed), { changeId: older.id }),
    ).rejects.toMatchObject({ code: 'changeOutOfOrder', detail: { blockers: ['change-2'] } })
    expect(bed.writer.calls).toEqual([])
  })

  it('dispatches the inverse for each operation kind', async () => {
    const cases: { readonly op: ChangeOp; readonly expected: string }[] = [
      { op: 'infoEntry.create', expected: 'delete:infoEntry:entry-1' },
      { op: 'customModule.create', expected: 'delete:infoEntry:entry-1' },
      { op: 'jobPosting.create', expected: 'delete:infoEntry:entry-1' },
      { op: 'infoEntry.update', expected: 'restore:infoEntry:entry-1:{"old":true}' },
      { op: 'infoEntry.delete', expected: 'restore:infoEntry:entry-1:{"old":true}' },
      { op: 'customModule.update', expected: 'restore:infoEntry:entry-1:{"old":true}' },
      { op: 'customModule.delete', expected: 'module:{"old":true}' },
      { op: 'infoEntry.reorder', expected: 'order:entry-1' },
      { op: 'customModule.reorder', expected: 'order:entry-1' },
    ]
    for (const testCase of cases) {
      const bed = createBed()
      const record = aRecord({
        op: testCase.op,
        beforeJson: testCase.op.includes('create') ? null : '{"old":true}',
      })
      await bed.changes.append(record)
      await undoLibraryChange(deps(bed), { changeId: record.id })
      expect(bed.writer.calls, testCase.op).toEqual([testCase.expected])
    }
  })

  it('fails loudly when an inverse needs a before payload the record does not carry', async () => {
    const bed = createBed()
    const record = aRecord({ op: 'infoEntry.update', beforeJson: null })
    await bed.changes.append(record)

    await expect(
      undoLibraryChange(deps(bed), { changeId: record.id }),
    ).rejects.toThrow(/没有 beforeJson/u)
    expect(bed.changes.calls).toEqual([])
  })
})
