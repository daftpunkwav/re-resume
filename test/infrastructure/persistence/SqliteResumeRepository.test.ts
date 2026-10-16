import { describe, expect, it } from 'vitest'
import { SqliteResumeRepository } from '../../../src/infrastructure/persistence/SqliteResumeRepository'
import type { SqlDatabase, SqlQueryResult, SqlValue } from '../../../src/infrastructure/persistence/sqlite'
import type { DocumentState } from '../../../src/domain/resume/DocumentChange'
import type { Revision } from '../../../src/domain/resume/Revision'
import type { ResumeSnapshot } from '../../../src/domain/resume/ResumeSnapshot'
import type { RevisionId } from '../../../src/domain/shared/branded-id'
import { createResume } from '../../../src/domain/resume/Resume'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { INITIAL_REVISION_LABEL } from '../../../src/domain/resume/Revision'
import { parseDateTime } from '../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  asBlockId,
  asClaimId,
  asExperienceId,
  asResumeId,
  asRevisionId,
  asSnapshotId,
  asVariantId,
} from '../../../src/domain/shared/branded-id'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'
import { initialRevision } from '../../support/inMemoryResumeRepository'

const NOW = parseDateTime('2026-03-01T00:00:00.000Z') as DateTime
const RESUME_ID = asResumeId('res-1')
const OTHER_RESUME_ID = asResumeId('res-2')
const INITIAL_REVISION_ID = asRevisionId('rev-initial')

const FIRST_STATE: DocumentState = {
  blocks: [
    {
      id: asBlockId('blk-1'),
      content: { type: 'text', text: '第一版' },
      layout: { mode: 'flow', columnSpan: 1 },
      textStyle: null,
    },
  ],
  pageSetup: A4_PAGE_SETUP,
}

const SECOND_STATE: DocumentState = {
  blocks: [
    ...FIRST_STATE.blocks,
    {
      id: asBlockId('blk-2'),
      content: {
        type: 'experience',
        experienceId: asExperienceId('exp-1'),
        variantId: asVariantId('var-1'),
        refVersion: 1,
        claimIds: [asClaimId('claim-1')],
      },
      layout: { mode: 'absolute', x: 0, y: 0, width: 10, height: 10, zIndex: 0, rotation: 0 },
      textStyle: null,
    },
  ],
  pageSetup: A4_PAGE_SETUP,
}

describe('SqliteResumeRepository', () => {
  async function newRepository(revisionLimit = 200) {
    const database = new FakeSqlDatabase()
    const clock = new FixedClock(NOW)
    const repository = new SqliteResumeRepository(
      database,
      clock,
      new SequentialIdGenerator('rev'),
      revisionLimit,
    )
    await repository.insertWithInitialRevision(
      createResume(
        {
          id: RESUME_ID,
          title: '后端简历',
          targetRole: '后端工程师',
          pageSetup: A4_PAGE_SETUP,
          initialRevisionId: INITIAL_REVISION_ID,
        },
        NOW,
      ),
      initialRevision(RESUME_ID, INITIAL_REVISION_ID, { blocks: [], pageSetup: A4_PAGE_SETUP }, NOW),
    )
    return { database, clock, repository }
  }

  const userChange = (label: string) => ({ label, origin: 'user', runId: null }) as const

  /**
   * Saves the way the use case does: the state is derived from the revision the
   * cursor names, and that revision is what the save expects to still be there.
   */
  async function saveNext(
    repository: SqliteResumeRepository,
    state: DocumentState,
    label: string,
  ): Promise<Revision> {
    const current = await repository.findById(RESUME_ID)
    if (current === null) throw new Error('the seeded resume should exist')
    return repository.saveDocument(RESUME_ID, state, userChange(label), current.currentRevision)
  }

  it('appends a revision at the next sequence number and moves the cursor', async () => {
    const { repository } = await newRepository()

    const revision = await saveNext(repository, FIRST_STATE, '添加文本')

    expect(revision.seq).toBe(2)
    expect(revision.label).toBe('添加文本')
    expect(revision.origin).toBe('user')
    const reloaded = await repository.findById(RESUME_ID)
    expect(reloaded?.currentRevision).toBe(revision.id)
    expect(reloaded?.blocks).toEqual(FIRST_STATE.blocks)
    expect(reloaded?.pageSetup).toEqual(A4_PAGE_SETUP)
  })

  it('stores the initial revision with the label the document model requires', async () => {
    const { repository } = await newRepository()

    const initial = await repository.readRevision(INITIAL_REVISION_ID)

    expect(initial?.label).toBe(INITIAL_REVISION_LABEL)
    expect(initial?.seq).toBe(1)
  })

  it('runs the append, the cursor move and the trim inside one transaction', async () => {
    const { database, repository } = await newRepository()

    await saveNext(repository, FIRST_STATE, '添加文本')

    const statements = database.executedSql
    const opened = statements.indexOf('BEGIN IMMEDIATE')
    const appended = statements.findIndex((sql) => sql.startsWith('INSERT INTO document_revision'))
    const committed = statements.indexOf('COMMIT')
    expect(opened).toBeGreaterThanOrEqual(0)
    expect(appended).toBeGreaterThan(opened)
    expect(committed).toBeGreaterThan(appended)
    expect(statements).not.toContain('ROLLBACK')
  })

  it('refuses a save derived from a revision the cursor has already left', async () => {
    const { repository } = await newRepository()
    const loaded = await repository.findById(RESUME_ID)
    if (loaded === null) throw new Error('the seeded resume should exist')
    await saveNext(repository, FIRST_STATE, '先改一次')

    // A second caller that read the resume before the first commit landed would
    // otherwise write a state derived from the same base and silently discard
    // the first edit.
    await expect(
      repository.saveDocument(
        RESUME_ID,
        SECOND_STATE,
        userChange('后改一次'),
        loaded.currentRevision,
      ),
    ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })

    const reloaded = await repository.findById(RESUME_ID)
    expect(reloaded?.blocks).toEqual(FIRST_STATE.blocks)
  })

  it('supersedes the abandoned branch but keeps its rows for audit', async () => {
    const { repository } = await newRepository()
    const second = await saveNext(repository, FIRST_STATE, '第二版')
    await repository.moveCursor(RESUME_ID, INITIAL_REVISION_ID)

    const third = await saveNext(repository, FIRST_STATE, '第三版')

    expect(third.seq).toBe(3)
    const abandoned = await repository.readRevision(second.id)
    expect(abandoned?.supersededAt).not.toBeNull()
  })

  it('never reuses a sequence number, even after a branch is abandoned', async () => {
    const { repository } = await newRepository()
    await saveNext(repository, FIRST_STATE, '第二版')
    await repository.moveCursor(RESUME_ID, INITIAL_REVISION_ID)

    const third = await saveNext(repository, SECOND_STATE, '第三版')

    expect(third.seq).toBe(3)
  })

  /** Freezes against the revision the snapshot was cut from, as the use case does. */
  async function freezeAsOfCurrent(
    repository: SqliteResumeRepository,
    snapshot: ResumeSnapshot = frozenSnapshot(),
  ): Promise<void> {
    const current = await repository.findById(RESUME_ID)
    if (current === null) throw new Error('the seeded resume should exist')
    await repository.appendSnapshot(snapshot, current.currentRevision)
  }

  it('refuses a freeze whose snapshot was cut from a revision the cursor has left', async () => {
    const { repository } = await newRepository()
    const loaded = await repository.findById(RESUME_ID)
    if (loaded === null) throw new Error('the seeded resume should exist')
    await saveNext(repository, FIRST_STATE, '先改一次')

    // Freezing reads the resume and materializes it before it writes, so the
    // cursor can move in between. The snapshot would then describe a revision
    // the frozen resume is no longer on.
    await expect(
      repository.appendSnapshot(frozenSnapshot(), loaded.currentRevision),
    ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })

    const reloaded = await repository.findById(RESUME_ID)
    expect(reloaded?.status).toBe('draft')
    expect(reloaded?.snapshots).toHaveLength(0)
  })

  it('refuses a new revision on a frozen resume', async () => {
    const { repository } = await newRepository()
    await freezeAsOfCurrent(repository)

    await expect(saveNext(repository, FIRST_STATE, '再改一次')).rejects.toMatchObject(
      { code: 'frozenResumeImmutable' },
    )
  })

  it('trims to the newest live revisions and never below the cursor', async () => {
    const { repository } = await newRepository(2)
    await saveNext(repository, FIRST_STATE, '第二版')
    await saveNext(repository, SECOND_STATE, '第三版')
    const fourth = await saveNext(repository, FIRST_STATE, '第四版')
    const fifth = await saveNext(repository, SECOND_STATE, '第五版')

    expect(await repository.readRevision(INITIAL_REVISION_ID)).toBeNull()
    expect(await repository.readRevision(fourth.id)).not.toBeNull()
    expect(await repository.readRevision(fifth.id)).not.toBeNull()
    const reloaded = await repository.findById(RESUME_ID)
    expect(reloaded?.currentRevision).toBe(fifth.id)
  })

  it('keeps the whole redo path that leads back to the trimmed window', async () => {
    const { repository } = await newRepository(2)
    await saveNext(repository, FIRST_STATE, '第二版')
    await saveNext(repository, SECOND_STATE, '第三版')
    const fourth = await saveNext(repository, FIRST_STATE, '第四版')

    expect((await repository.readRevision(fourth.id))?.seq).toBe(4)
  })

  it('never trims a superseded row, which is kept for audit', async () => {
    const { repository } = await newRepository(2)
    const second = await saveNext(repository, FIRST_STATE, '第二版')
    await repository.moveCursor(RESUME_ID, INITIAL_REVISION_ID)
    const third = await saveNext(repository, FIRST_STATE, '第三版')
    await saveNext(repository, SECOND_STATE, '第四版')

    expect(await repository.readRevision(second.id)).not.toBeNull()
    expect(await repository.readRevision(third.id)).not.toBeNull()
  })

  it('restores the document state the cursor lands on', async () => {
    const { repository } = await newRepository()
    await saveNext(repository, FIRST_STATE, '第二版')
    await saveNext(repository, SECOND_STATE, '第三版')

    await repository.moveCursor(RESUME_ID, INITIAL_REVISION_ID)

    const undone = await repository.findById(RESUME_ID)
    expect(undone?.currentRevision).toBe(INITIAL_REVISION_ID)
    expect(undone?.blocks).toEqual([])
  })

  it('refuses to move the cursor on a frozen resume', async () => {
    const { repository } = await newRepository()
    const second = await saveNext(repository, FIRST_STATE, '第二版')
    await freezeAsOfCurrent(repository)

    await expect(repository.moveCursor(RESUME_ID, second.id)).rejects.toMatchObject({
      code: 'frozenResumeImmutable',
    })
  })

  it('refuses to move the cursor onto a superseded revision', async () => {
    const { repository } = await newRepository()
    const second = await saveNext(repository, FIRST_STATE, '第二版')
    await repository.moveCursor(RESUME_ID, INITIAL_REVISION_ID)
    await saveNext(repository, FIRST_STATE, '第三版')

    await expect(repository.moveCursor(RESUME_ID, second.id)).rejects.toMatchObject({
      code: 'cursorNotOnLiveChain',
    })
  })

  it("refuses to move the cursor onto another resume's revision", async () => {
    const { repository } = await newRepository()
    const foreign = await seedForeignResume(repository)

    await expect(repository.moveCursor(RESUME_ID, foreign)).rejects.toMatchObject({
      code: 'cursorNotOnLiveChain',
    })
  })

  it('refuses to move the cursor onto a revision that does not exist', async () => {
    const { repository } = await newRepository()

    await expect(repository.moveCursor(RESUME_ID, asRevisionId('rev-absent'))).rejects.toMatchObject({
      code: 'cursorNotOnLiveChain',
    })
  })

  it('leaves the chain untouched when the append fails part way through', async () => {
    const { database, repository } = await newRepository()
    database.failWhenStatementContains = 'INSERT INTO document_revision'

    await expect(saveNext(repository, FIRST_STATE, '会失败')).rejects.toThrow()

    const reloaded = await repository.findById(RESUME_ID)
    expect(reloaded?.currentRevision).toBe(INITIAL_REVISION_ID)
    expect(database.tables.get('document_revision')).toHaveLength(1)
    expect(database.executedSql).toContain('ROLLBACK')
  })

  it('freezes the resume together with the snapshot that justifies it', async () => {
    const { repository } = await newRepository()
    await saveNext(repository, FIRST_STATE, '第二版')

    await freezeAsOfCurrent(repository)

    const reloaded = await repository.findById(RESUME_ID)
    expect(reloaded?.status).toBe('frozen')
    expect(reloaded?.snapshots).toHaveLength(1)
    // The snapshot's own page setup, not the page setup of the revision it was cut from.
    expect(reloaded?.snapshots[0]?.pageSetup.marginLeft).toBe(48)
  })

  it('returns null for a resume that does not exist', async () => {
    const { repository } = await newRepository()

    expect(await repository.findById(asResumeId('res-absent'))).toBeNull()
    expect(await repository.readRevision(asRevisionId('rev-absent'))).toBeNull()
  })

  it('refuses to hydrate a cursor that names no stored revision', async () => {
    const { database, repository } = await newRepository()
    const rows = database.tables.get('document_revision') ?? []
    database.tables.set('document_revision', [])

    await expect(repository.findById(RESUME_ID)).rejects.toThrow(/current_revision_id/)
    expect(rows).toHaveLength(1)
  })

  it('hydrates every resume from listAll', async () => {
    const { repository } = await newRepository()
    await seedForeignResume(repository)

    const all = await repository.listAll()

    expect(all.map((resume) => resume.id).sort()).toEqual([OTHER_RESUME_ID, RESUME_ID].sort())
    expect(all.find((resume) => resume.id === RESUME_ID)?.title).toBe('后端简历')
  })
})

function frozenSnapshot(): ResumeSnapshot {
  return {
    id: asSnapshotId('snap-1'),
    resumeId: RESUME_ID,
    seq: 1,
    materializedBlocks: [],
    pageSetup: { ...A4_PAGE_SETUP, marginLeft: 48 },
    createdAt: NOW,
  }
}

async function seedForeignResume(repository: SqliteResumeRepository): Promise<RevisionId> {
  const revisionId = asRevisionId('rev-foreign')
  await repository.insertWithInitialRevision(
    createResume(
      {
        id: OTHER_RESUME_ID,
        title: '另一份简历',
        targetRole: null,
        pageSetup: A4_PAGE_SETUP,
        initialRevisionId: revisionId,
      },
      NOW,
    ),
    initialRevision(OTHER_RESUME_ID, revisionId, { blocks: [], pageSetup: A4_PAGE_SETUP }, NOW),
  )
  return revisionId
}

type Row = Record<string, unknown>

interface WhereCondition {
  readonly column: string
  readonly operator: 'is null' | 'is not null' | '=' | '>' | '<'
  readonly operand: number | null
}

/**
 * A minimal SQL engine over flat rows: enough to exercise the repository's
 * statements without a Tauri runtime. It deliberately understands only the
 * forms this repository issues and throws on anything else, so an unexpected
 * query shows up as a failing test rather than as a silently empty result.
 */
class FakeSqlDatabase implements SqlDatabase {
  readonly tables = new Map<string, Row[]>()
  readonly executedSql: string[] = []
  failWhenStatementContains: string | null = null

  constructor() {
    this.tables.set('resume', [])
    this.tables.set('document_revision', [])
    this.tables.set('resume_snapshot', [])
  }

  async execute(query: string, bindValues: readonly SqlValue[] = []): Promise<SqlQueryResult> {
    const sql = normalize(query)
    this.executedSql.push(sql)
    this.#guard(sql)

    if (sql === 'BEGIN IMMEDIATE' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rowsAffected: 0 }
    }
    const insert = /^INSERT INTO (\w+) \((.+)\) VALUES \((.+)\)$/.exec(sql)
    if (insert !== null) {
      const columns = (insert[2] ?? '').split(',').map((name) => name.trim())
      const row: Row = {}
      columns.forEach((column, position) => {
        row[column] = bindValues[position] ?? null
      })
      this.#table(insert[1] ?? '').push(row)
      return { rowsAffected: 1 }
    }
    const update = /^UPDATE (\w+) SET (.+) WHERE (.+)$/.exec(sql)
    if (update !== null) {
      const assignments = parseAssignments(update[2] ?? '')
      const targets = this.#table(update[1] ?? '').filter(
        (row) => evaluate(conditionsOf(update[3] ?? ''), row, bindValues),
      )
      for (const row of targets) {
        for (const [column, placeholder] of assignments) {
          row[column] = bindValues[placeholder - 1] ?? null
        }
      }
      return { rowsAffected: targets.length }
    }
    const deletion = /^DELETE FROM (\w+) WHERE (.+)$/.exec(sql)
    if (deletion !== null) {
      const table = this.#table(deletion[1] ?? '')
      const doomed = table.filter((row) => evaluate(conditionsOf(deletion[2] ?? ''), row, bindValues))
      this.tables.set(
        deletion[1] ?? '',
        table.filter((row) => !evaluate(conditionsOf(deletion[2] ?? ''), row, bindValues)),
      )
      return { rowsAffected: doomed.length }
    }
    throw new Error(`FakeSqlDatabase cannot execute: ${sql}`)
  }

  async select<T>(query: string, bindValues: readonly SqlValue[] = []): Promise<readonly T[]> {
    const sql = normalize(query)
    this.executedSql.push(sql)
    this.#guard(sql)

    const head = /^SELECT .+ FROM (\w+)/.exec(sql)
    if (head === null) throw new Error(`FakeSqlDatabase cannot select: ${sql}`)
    const tableName = head[1] ?? ''
    let remainder = sql.slice(head[0].length).trim()

    let orderBy: readonly string[] = []
    const ordered = /^(.*) ORDER BY (.+)$/.exec(remainder)
    if (ordered !== null) {
      remainder = (ordered[1] ?? '').trim()
      orderBy = (ordered[2] ?? '')
        .split(',')
        .map((entry) => entry.trim().split(/\s+/)[0] ?? '')
    }
    const where = remainder.startsWith('WHERE ') ? conditionsOf(remainder.slice('WHERE '.length)) : []

    const rows = this.#table(tableName).filter((row) => evaluate(where, row, bindValues))
    return [...rows]
      .sort((left, right) => compareBy(left, right, orderBy))
      .map((row) => ({ ...row }) as T)
  }

  async transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    const snapshot = new Map([...this.tables].map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]))
    this.executedSql.push('BEGIN IMMEDIATE')
    try {
      const result = await work(this)
      this.executedSql.push('COMMIT')
      return result
    } catch (error) {
      this.tables.clear()
      for (const [name, rows] of snapshot) this.tables.set(name, rows)
      this.executedSql.push('ROLLBACK')
      throw error
    }
  }

  #table(name: string): Row[] {
    const table = this.tables.get(name)
    if (table === undefined) throw new Error(`FakeSqlDatabase has no table "${name}"`)
    return table
  }

  #guard(sql: string): void {
    if (this.failWhenStatementContains !== null && sql.includes(this.failWhenStatementContains)) {
      this.failWhenStatementContains = null
      throw new Error(`FakeSqlDatabase was told to fail on: ${sql}`)
    }
  }
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function conditionsOf(where: string): readonly WhereCondition[] {
  return where.split(' AND ').map((clause) => {
    const nullMatch = /^(\w+) IS (NOT )?NULL$/.exec(clause)
    if (nullMatch !== null) {
      return {
        column: nullMatch[1] ?? '',
        operator: (nullMatch[2] === undefined ? 'is null' : 'is not null') as WhereCondition['operator'],
        operand: null,
      }
    }
    const comparison = /^(\w+) (=|>|<) \$(\d+)$/.exec(clause)
    if (comparison !== null) {
      return {
        column: comparison[1] ?? '',
        operator: comparison[2] as WhereCondition['operator'],
        operand: Number(comparison[3]),
      }
    }
    throw new Error(`FakeSqlDatabase does not implement the condition: ${clause}`)
  })
}

function parseAssignments(set: string): readonly (readonly [string, number])[] {
  return set.split(',').map((assignment) => {
    const match = /^(\w+) = \$(\d+)$/.exec(assignment.trim())
    if (match === null) throw new Error(`FakeSqlDatabase does not implement the assignment: ${assignment}`)
    return [match[1] ?? '', Number(match[2])] as const
  })
}

function evaluate(conditions: readonly WhereCondition[], row: Row, bindValues: readonly SqlValue[]): boolean {
  return conditions.every((condition) => {
    const value = row[condition.column] ?? null
    switch (condition.operator) {
      case 'is null':
        return value === null
      case 'is not null':
        return value !== null
      case '=':
        return value === bindValues[(condition.operand ?? 1) - 1]
      case '>':
        return Number(value) > Number(bindValues[(condition.operand ?? 1) - 1])
      case '<':
        return Number(value) < Number(bindValues[(condition.operand ?? 1) - 1])
    }
  })
}

function compareBy(left: Row, right: Row, columns: readonly string[]): number {
  for (const column of columns) {
    const difference = Number(left[column] ?? 0) - Number(right[column] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
