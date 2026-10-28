/**
 * @file resumeRepository.test
 * @description The SQLite resume repository against a real database file-less
 * schema: round trips, the revision chain transaction (supersede, append,
 * cursor, trim), snapshots and the frozen transition, metadata writes, cascade
 * and the row-mapping refusals.
 */

import { describe, expect, it } from 'vitest'

import { SqliteResumeRepository } from '../../../src/infrastructure/persistence/resume/SqliteResumeRepository'
import { RowMappingError } from '../../../src/infrastructure/persistence/JsonEnvelope'
import {
  asConversationId,
  asResumeId,
  asRevisionId,
  asSnapshotId,
  asTemplateId,
} from '../../../src/domain/shared/branded-id'
import type { ResumeId, RevisionId } from '../../../src/domain/shared/branded-id'
import type { Revision } from '../../../src/domain/resume/Revision'
import type { ResumeSnapshot } from '../../../src/domain/resume/ResumeSnapshot'
import { INITIAL_REVISION_LABEL } from '../../../src/domain/resume/Revision'
import { createMigratedDatabase } from '../../support/nodeSqliteDatabase'
import type { NodeSqliteDatabase } from '../../support/nodeSqliteDatabase'
import {
  FIXTURE_TIME,
  TestClock,
  TestIds,
  aDividerBlock,
  aDocument,
  aResume,
  aSummaryOverride,
  aTextBlock,
  anEntryOverride,
} from '../../support/resumeFixtures'

interface Harness {
  readonly database: NodeSqliteDatabase
  readonly repository: SqliteResumeRepository
  readonly clock: TestClock
  readonly ids: TestIds
}

function harness(revisionLimit?: number): Harness {
  const database = createMigratedDatabase()
  const clock = new TestClock()
  const ids = new TestIds('repo')
  return {
    database,
    repository:
      revisionLimit === undefined
        ? new SqliteResumeRepository(database, clock, ids)
        : new SqliteResumeRepository(database, clock, ids, revisionLimit),
    clock,
    ids,
  }
}

function withDocument(
  base: ReturnType<typeof aResume>,
  document: ReturnType<typeof aDocument>,
): { resume: ReturnType<typeof aResume>['resume']; revision: Revision } {
  return {
    resume: { ...base.resume, document },
    revision: { ...base.revision, state: document },
  }
}

async function countRows(database: NodeSqliteDatabase, table: string): Promise<number> {
  const rows = await database.select<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${table}`,
  )
  return rows[0]?.count ?? 0
}

async function aRevision(
  repository: SqliteResumeRepository,
  resumeId: ResumeId,
  state: ReturnType<typeof aDocument>,
  expected: RevisionId,
  label = '变更',
): Promise<Revision> {
  return repository.saveDocument(
    resumeId,
    state,
    { label, origin: 'user', runId: null },
    expected,
  )
}

describe('round trips', () => {
  it('hydrates the aggregate exactly as it was inserted', async () => {
    const h = harness()
    const twoColumn = aDocument({
      templateId: asTemplateId('two-column-sidebar'),
      sections: [
        {
          ...(aDocument().sections[0] as NonNullable<ReturnType<typeof aDocument>['sections'][number]>),
          column: 1,
        },
      ],
      overrides: [aSummaryOverride('总结'), anEntryOverride('preview-project-1', '改写')],
      freeBlocks: [aTextBlock('free-text', { x: 120, y: 200 }), aDividerBlock('free-divider')],
    })
    const fixture = withDocument(aResume({ targetJob: { title: '岗位', company: '公司', jobPostingId: null } }), twoColumn)
    const resume = { ...fixture.resume, conversationId: asConversationId('conversation-1') }
    await h.repository.insertWithInitialRevision(resume, fixture.revision)

    const loaded = await h.repository.findById(resume.id)
    expect(loaded).toEqual(resume)
  })

  it('lists resumes ordered by creation time', async () => {
    const h = harness()
    const first = aResume({ id: 'resume-a' })
    const second = aResume({ id: 'resume-b' })
    await h.repository.insertWithInitialRevision(first.resume, first.revision)
    await h.repository.insertWithInitialRevision(second.resume, second.revision)
    const all = await h.repository.listAll()
    expect(all.map((resume) => resume.id)).toEqual(['resume-a', 'resume-b'])
  })

  it('returns null for a missing resume', async () => {
    const h = harness()
    expect(await h.repository.findById(asResumeId('missing'))).toBeNull()
  })
})

describe('revision chain', () => {
  it('appends a revision, moves the cursor and supersedes the abandoned branch', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    const one = await aRevision(h.repository, fixture.resume.id, aDocument(), fixture.revision.id, '第一次')
    const two = await aRevision(h.repository, fixture.resume.id, aDocument(), one.id, '第二次')
    expect(two.seq).toBe(3)
    expect((await h.repository.findById(fixture.resume.id))?.currentRevision).toBe(two.id)

    await h.repository.moveCursor(fixture.resume.id, one.id)
    const three = await aRevision(h.repository, fixture.resume.id, aDocument(), one.id, '新分支')
    expect(three.seq).toBe(4)
    const revisions = await h.repository.listRevisions(fixture.resume.id)
    const abandoned = revisions.find((revision) => revision.id === two.id)
    expect(abandoned?.supersededAt).not.toBeNull()
    expect(revisions.find((revision) => revision.id === one.id)?.supersededAt).toBeNull()
  })

  it('refuses a stale expected revision', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    await aRevision(h.repository, fixture.resume.id, aDocument(), fixture.revision.id)
    await expect(
      aRevision(h.repository, fixture.resume.id, aDocument(), fixture.revision.id),
    ).rejects.toMatchObject({ code: 'revisionMismatch' })
  })

  it('refuses a change on a frozen resume and on a missing one', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    await h.database.execute("UPDATE resume SET status = 'frozen' WHERE id = $1", [
      fixture.resume.id,
    ])
    await expect(
      aRevision(h.repository, fixture.resume.id, aDocument(), fixture.revision.id),
    ).rejects.toMatchObject({ code: 'resumeFrozen' })
    await expect(
      aRevision(h.repository, asResumeId('missing'), aDocument(), asRevisionId('unknown')),
    ).rejects.toMatchObject({ code: 'resumeNotFound' })
  })

  it('keeps only the newest live window while retaining superseded rows', async () => {
    const h = harness(3)
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    let cursor: RevisionId = fixture.revision.id
    for (let index = 0; index < 6; index += 1) {
      const revision = await aRevision(h.repository, fixture.resume.id, aDocument(), cursor)
      cursor = revision.id
    }
    const revisions = await h.repository.listRevisions(fixture.resume.id)
    const live = revisions.filter((revision) => revision.supersededAt === null)
    expect(live.length).toBeLessThanOrEqual(3)
    expect(live[live.length - 1]?.id).toBe(cursor)
    // The cursor is still reachable: findById reads it without the chain.
    const loaded = await h.repository.findById(fixture.resume.id)
    expect(loaded?.currentRevision).toBe(cursor)
  })

  it('moves the cursor only onto a live revision of the same resume', async () => {
    const h = harness()
    const first = aResume({ id: 'resume-a' })
    const second = aResume({ id: 'resume-b' })
    await h.repository.insertWithInitialRevision(first.resume, first.revision)
    await h.repository.insertWithInitialRevision(second.resume, second.revision)
    await expect(
      h.repository.moveCursor(first.resume.id, second.revision.id),
    ).rejects.toMatchObject({ code: 'cursorNotOnLiveChain' })
    await h.repository.moveCursor(first.resume.id, first.revision.id)
    expect((await h.repository.findById(first.resume.id))?.currentRevision).toBe(
      first.revision.id,
    )
  })
})

describe('snapshots and freezing', () => {
  function aSnapshot(resumeId: ResumeId, document: ReturnType<typeof aDocument>): ResumeSnapshot {
    return {
      id: asSnapshotId('snapshot-1'),
      resumeId,
      seq: 1,
      frozenState: document,
      materialized: { blocks: [], missingReferences: [], warnings: [] },
      createdAt: FIXTURE_TIME,
    }
  }

  it('appends the snapshot and flips the status in one transaction', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    const snapshot = aSnapshot(fixture.resume.id, fixture.resume.document)
    await h.repository.appendSnapshot(snapshot, fixture.revision.id)

    const loaded = await h.repository.findById(fixture.resume.id)
    expect(loaded?.status).toBe('frozen')
    expect(loaded?.snapshots).toEqual([snapshot])
    expect(await h.repository.findSnapshotById(snapshot.id)).toEqual(snapshot)
    await expect(
      h.repository.appendSnapshot(snapshot, fixture.revision.id),
    ).rejects.toMatchObject({ code: 'resumeFrozen' })
  })

  it('refuses a snapshot for a cursor that moved', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    await expect(
      h.repository.appendSnapshot(
        aSnapshot(fixture.resume.id, fixture.resume.document),
        asRevisionId('other'),
      ),
    ).rejects.toMatchObject({ code: 'revisionMismatch' })
    expect((await h.repository.findById(fixture.resume.id))?.status).toBe('draft')
  })
})

describe('metadata writes', () => {
  it('patches only the named fields', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    await h.repository.updateMetadata(fixture.resume.id, { title: '新标题' }, FIXTURE_TIME)
    expect((await h.repository.findById(fixture.resume.id))?.title).toBe('新标题')
    await h.repository.updateMetadata(
      fixture.resume.id,
      { targetJob: { title: '岗位', company: null, jobPostingId: null } },
      FIXTURE_TIME,
    )
    const loaded = await h.repository.findById(fixture.resume.id)
    expect(loaded?.title).toBe('新标题')
    expect(loaded?.targetJob?.title).toBe('岗位')
    await h.repository.updateMetadata(fixture.resume.id, { targetJob: null }, FIXTURE_TIME)
    expect((await h.repository.findById(fixture.resume.id))?.targetJob).toBeNull()
  })

  it('refuses a missing resume', async () => {
    const h = harness()
    await expect(
      h.repository.updateMetadata(asResumeId('missing'), { title: '标题' }, FIXTURE_TIME),
    ).rejects.toMatchObject({ code: 'resumeNotFound' })
  })
})

describe('delete', () => {
  it('cascades revisions and snapshots and clears cross-domain pointers', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    const document = fixture.resume.document
    await h.repository.appendSnapshot(
      {
        id: asSnapshotId('snapshot-1'),
        resumeId: fixture.resume.id,
        seq: 1,
        frozenState: document,
        materialized: { blocks: [], missingReferences: [], warnings: [] },
        createdAt: FIXTURE_TIME,
      },
      fixture.revision.id,
    )
    await h.database.execute(
      `INSERT INTO conversation (id, title, active_resume_id, created_at, updated_at)
       VALUES ('conversation-1', '会话', $1, $2, $2)`,
      [fixture.resume.id, FIXTURE_TIME],
    )
    await h.database.execute(
      `INSERT INTO agent_run (id, conversation_id, resume_id, status, started_at)
       VALUES ('run-1', 'conversation-1', $1, 'failed', $2)`,
      [fixture.resume.id, FIXTURE_TIME],
    )

    await h.repository.delete(fixture.resume.id)
    expect(await h.repository.findById(fixture.resume.id)).toBeNull()
    expect(await countRows(h.database, 'resume_revision')).toBe(0)
    expect(await countRows(h.database, 'resume_snapshot')).toBe(0)
    const conversation = await h.database.select<{ active_resume_id: string | null }>(
      "SELECT active_resume_id FROM conversation WHERE id = 'conversation-1'",
    )
    expect(conversation[0]?.active_resume_id).toBeNull()
    const run = await h.database.select<{ resume_id: string | null }>(
      "SELECT resume_id FROM agent_run WHERE id = 'run-1'",
    )
    expect(run[0]?.resume_id).toBeNull()
  })

  it('refuses a missing resume', async () => {
    const h = harness()
    await expect(h.repository.delete(asResumeId('missing'))).rejects.toMatchObject({
      code: 'resumeNotFound',
    })
  })
})

describe('transaction and row contracts', () => {
  it('leaves no revision and keeps the cursor when a write fails mid-transaction', async () => {
    const database = createMigratedDatabase()
    const clock = new TestClock()
    let calls = 0
    const repository = new SqliteResumeRepository(database, clock, {
      next: () => {
        calls += 1
        throw new Error(`boom-${calls.toString()}`)
      },
    })
    const fixture = aResume()
    await repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    await expect(
      repository.saveDocument(
        fixture.resume.id,
        aDocument(),
        { label: '失败变更', origin: 'user', runId: null },
        fixture.revision.id,
      ),
    ).rejects.toThrow('boom-1')
    expect(await countRows(database, 'resume_revision')).toBe(1)
    expect((await repository.findById(fixture.resume.id))?.currentRevision).toBe(
      fixture.revision.id,
    )
  })

  it('refuses a corrupted state envelope and a bad target job column', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    await h.database.execute("UPDATE resume_revision SET state_json = '{\"v\":1,\"data\":{}}'")
    await expect(h.repository.findById(fixture.resume.id)).rejects.toBeInstanceOf(RowMappingError)
  })

  it('refuses an invalid enum in a stored document', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    const payload = JSON.parse(
      (await h.database.select<{ state_json: string }>('SELECT state_json FROM resume_revision'))[0]
        ?.state_json ?? '{}',
    ) as { v: number; data: { pageSetup: { paper: string } } }
    payload.data.pageSetup.paper = 'A3'
    await h.database.execute('UPDATE resume_revision SET state_json = $1', [
      JSON.stringify(payload),
    ])
    await expect(h.repository.findById(fixture.resume.id)).rejects.toBeInstanceOf(RowMappingError)
  })

  it('refuses a cursor that names a revision of no resume', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    await h.database.execute("UPDATE resume SET current_revision_id = 'ghost'")
    await expect(h.repository.findById(fixture.resume.id)).rejects.toBeInstanceOf(RowMappingError)
  })

  it('refuses an unknown resume status', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    // The CHECK constraint makes an unknown status unrepresentable through the
    // normal write path; disabling it isolates the mapper's own enum check.
    h.database.execScript('PRAGMA ignore_check_constraints = ON')
    await h.database.execute("UPDATE resume SET status = 'archived'")
    await expect(h.repository.findById(fixture.resume.id)).rejects.toBeInstanceOf(RowMappingError)
  })

  it('keeps the first revision label and the initial cursor', async () => {
    const h = harness()
    const fixture = aResume()
    await h.repository.insertWithInitialRevision(fixture.resume, fixture.revision)
    const revisions = await h.repository.listRevisions(fixture.resume.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]?.label).toBe(INITIAL_REVISION_LABEL)
    expect(revisions[0]?.id).toBe(fixture.revision.id)
  })
})
