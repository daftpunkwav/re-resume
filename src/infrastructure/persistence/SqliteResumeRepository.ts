/**
 * @file SqliteResumeRepository
 * @description SQLite persistence for the resume aggregate: the pointer row,
 * the revision chain that doubles as its undo/redo history, and the frozen
 * snapshots.
 *
 * Constraints:
 * - saveDocument performs four steps — supersede the abandoned branch, append
 *   the new revision, move the cursor, trim — inside one transaction. Partial
 *   application is a contract violation: a revision without a cursor move is an
 *   invisible edit, and a cursor moved without a trim is unbounded growth.
 * - seq is max(seq) + 1 over the whole history including superseded rows, so a
 *   sequence number is never reused and UNIQUE (resume_id, seq) always holds.
 * - Trim never touches the cursor or anything reachable from it by redo, and
 *   never deletes a superseded row: abandoned branches are kept for audit.
 * - moveCursor refuses a frozen resume and refuses a target that is superseded
 *   or belongs to another resume. Both refusals use cursorNotOnLiveChain or
 *   frozenResumeImmutable, the codes the domain already defines.
 */

import { DomainError } from '../../domain/shared/DomainError'
import { nextSeq } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import type { Resume } from '../../domain/resume/Resume'
import type { ResumeSnapshot } from '../../domain/resume/ResumeSnapshot'
import type { DocumentChangeMeta, DocumentState } from '../../domain/resume/DocumentChange'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { Clock } from '../../domain/catalog/ports/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { ResumeId, RevisionId } from '../../domain/shared/branded-id'
import { RowMappingError } from './mappers/JsonEnvelope'
import {
  fromDocumentRevisionRow,
  fromResumeSnapshotRow,
  hydrateResume,
  toDocumentRevisionRow,
  toResumeRow,
  toResumeSnapshotRow,
} from './mappers/ResumeRowMapper'
import type {
  DocumentRevisionRow,
  ResumeRow,
  ResumeSnapshotRow,
} from './mappers/ResumeRowMapper'
import type { SqlDatabase } from './sqlite'

export const DEFAULT_REVISION_LIMIT = 200

interface RevisionSeqRow {
  readonly id: string
  readonly seq: number
}

export class SqliteResumeRepository implements ResumeRepository {
  readonly #database: SqlDatabase
  readonly #clock: Clock
  readonly #ids: IdGenerator
  readonly #revisionLimit: number

  constructor(
    database: SqlDatabase,
    clock: Clock,
    ids: IdGenerator,
    revisionLimit: number = DEFAULT_REVISION_LIMIT,
  ) {
    this.#database = database
    this.#clock = clock
    this.#ids = ids
    this.#revisionLimit = revisionLimit
  }

  async findById(id: ResumeId): Promise<Resume | null> {
    const rows = await this.#database.select<ResumeRow>('SELECT * FROM resume WHERE id = $1', [id])
    const row = rows[0]
    if (row === undefined) return null
    const revisions = await this.#readHistory(id)
    const snapshots = await this.#readSnapshots(id)
    return hydrateResume(row, this.#requireCursor(row, revisions), snapshots)
  }

  async listAll(): Promise<readonly Resume[]> {
    const rows = await this.#database.select<ResumeRow>('SELECT * FROM resume ORDER BY created_at ASC, id ASC')
    if (rows.length === 0) return []
    const revisionsByResume = groupByResumeId(
      await this.#database.select<DocumentRevisionRow>('SELECT * FROM document_revision ORDER BY seq ASC'),
    )
    const snapshotsByResume = groupByResumeId(
      await this.#database.select<ResumeSnapshotRow>('SELECT * FROM resume_snapshot ORDER BY seq ASC'),
    )
    return rows.map((row) => {
      const revisions = (revisionsByResume.get(row.id) ?? []).map(fromDocumentRevisionRow)
      return hydrateResume(
        row,
        this.#requireCursor(row, revisions),
        (snapshotsByResume.get(row.id) ?? []).map(fromResumeSnapshotRow),
      )
    })
  }

  async saveDocument(
    id: ResumeId,
    state: DocumentState,
    change: DocumentChangeMeta,
  ): Promise<Revision> {
    return this.#database.transaction(async () => {
      const resumeRow = await this.#requireResumeRow(id)
      if (resumeRow.status === 'frozen') {
        throw new DomainError(
          'frozenResumeImmutable',
          'A frozen resume cannot take another revision. Duplicate it to keep iterating.',
          { entity: 'resume', id, blockers: [] },
        )
      }
      const history = await this.#readHistory(id)
      const cursor = this.#requireCursor(resumeRow, history)
      if (cursor.supersededAt !== null) {
        throw new DomainError(
          'cursorNotOnLiveChain',
          'The cursor sits on an abandoned branch; a new change must start from the chain tail.',
          { entity: 'resume', id, blockers: [cursor.id] },
        )
      }
      const now = this.#clock.now()
      await this.#database.execute(
        `UPDATE document_revision SET superseded_at = $1
         WHERE resume_id = $2 AND seq > $3 AND superseded_at IS NULL`,
        [now, id, cursor.seq],
      )
      const revision: Revision = {
        id: this.#ids.next() as RevisionId,
        resumeId: id,
        seq: nextSeq(history),
        label: change.label,
        origin: change.origin,
        runId: change.runId,
        state,
        supersededAt: null,
        createdAt: now,
      }
      await this.#insertRevision(revision)
      await this.#database.execute(
        'UPDATE resume SET current_revision_id = $1, updated_at = $2 WHERE id = $3',
        [revision.id, now, id],
      )
      await this.#trimHistory(id, revision.id)
      return revision
    })
  }

  async moveCursor(id: ResumeId, revisionId: RevisionId): Promise<void> {
    await this.#database.transaction(async () => {
      const resumeRow = await this.#requireResumeRow(id)
      if (resumeRow.status === 'frozen') {
        throw new DomainError(
          'frozenResumeImmutable',
          'A frozen resume keeps the revision it was frozen at; its history is read-only.',
          { entity: 'resume', id, blockers: [] },
        )
      }
      const targets = await this.#database.select<DocumentRevisionRow>(
        'SELECT * FROM document_revision WHERE id = $1',
        [revisionId],
      )
      const target = targets[0]
      if (target === undefined) {
        throw new DomainError('cursorNotOnLiveChain', 'No such revision.', {
          entity: 'resume',
          id,
          blockers: [revisionId],
        })
      }
      if (target.resume_id !== id) {
        throw new DomainError(
          'cursorNotOnLiveChain',
          'The revision belongs to another resume, so it cannot become this cursor.',
          { entity: 'resume', id, blockers: [revisionId] },
        )
      }
      if (target.superseded_at !== null) {
        throw new DomainError(
          'cursorNotOnLiveChain',
          'The cursor may only sit on a live revision; this one was superseded.',
          { entity: 'resume', id, blockers: [revisionId] },
        )
      }
      await this.#database.execute(
        'UPDATE resume SET current_revision_id = $1, updated_at = $2 WHERE id = $3',
        [revisionId, this.#clock.now(), id],
      )
    })
  }

  async readRevision(id: RevisionId): Promise<Revision | null> {
    const rows = await this.#database.select<DocumentRevisionRow>(
      'SELECT * FROM document_revision WHERE id = $1',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : fromDocumentRevisionRow(row)
  }

  /**
   * Freezing is two writes: the snapshot that justifies the status, and the
   * status itself. Invariant 3 holds because both land together — a frozen
   * resume without its snapshot is unreachable, not merely unlikely.
   */
  async appendSnapshot(snapshot: ResumeSnapshot): Promise<void> {
    const row = toResumeSnapshotRow(snapshot)
    await this.#database.transaction(async () => {
      await this.#database.execute(
        `INSERT INTO resume_snapshot (id, resume_id, seq, materialized_json, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.id, row.resume_id, row.seq, row.materialized_json, row.created_at],
      )
      await this.#database.execute(
        'UPDATE resume SET status = $1, updated_at = $2 WHERE id = $3',
        ['frozen', snapshot.createdAt, snapshot.resumeId],
      )
    })
  }

  /**
   * Creates a resume together with the initial revision it points at. The
   * resume row is written first: document_revision.resume_id is a real foreign
   * key, while resume.current_revision_id deliberately is not, which is what
   * lets the two reference each other (see the schema).
   */
  async insertWithInitialRevision(resume: Resume, revision: Revision): Promise<void> {
    const resumeRow = toResumeRow(resume)
    await this.#database.transaction(async () => {
      await this.#database.execute(
        `INSERT INTO resume (id, title, target_role, status, current_revision_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          resumeRow.id,
          resumeRow.title,
          resumeRow.target_role,
          resumeRow.status,
          resumeRow.current_revision_id,
          resumeRow.created_at,
          resumeRow.updated_at,
        ],
      )
      await this.#insertRevision(revision)
    })
  }

  async #insertRevision(revision: Revision): Promise<void> {
    const row = toDocumentRevisionRow(revision)
    await this.#database.execute(
      `INSERT INTO document_revision
         (id, resume_id, seq, label, origin, run_id, blocks_json, page_setup_json, superseded_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.id,
        row.resume_id,
        row.seq,
        row.label,
        row.origin,
        row.run_id,
        row.blocks_json,
        row.page_setup_json,
        row.superseded_at,
        row.created_at,
      ],
    )
  }

  /**
   * Keeps the newest limit live revisions. The delete bound is the older of the
   * window start and the cursor, so a cursor that somehow sits behind the window
   * stretches the window back to reach it: the cursor and everything reachable
   * from it by redo are never trimmed. Superseded rows are never deleted — an
   * abandoned branch is kept for audit.
   */
  async #trimHistory(resumeId: ResumeId, cursorRevisionId: RevisionId): Promise<void> {
    const liveRows = await this.#database.select<RevisionSeqRow>(
      `SELECT id, seq FROM document_revision
       WHERE resume_id = $1 AND superseded_at IS NULL ORDER BY seq ASC`,
      [resumeId],
    )
    if (liveRows.length <= this.#revisionLimit) return
    const newest = liveRows.slice(-this.#revisionLimit)
    const cursor = liveRows.find((row) => row.id === cursorRevisionId)
    if (cursor === undefined) return
    const oldestKept = newest[0]
    if (oldestKept === undefined) return
    await this.#database.execute(
      `DELETE FROM document_revision
       WHERE resume_id = $1 AND superseded_at IS NULL AND seq < $2`,
      [resumeId, Math.min(oldestKept.seq, cursor.seq)],
    )
  }

  async #requireResumeRow(id: ResumeId): Promise<ResumeRow> {
    const rows = await this.#database.select<ResumeRow>('SELECT * FROM resume WHERE id = $1', [id])
    const row = rows[0]
    if (row === undefined) {
      throw new DomainError('cursorNotOnLiveChain', 'No such resume.', {
        entity: 'resume',
        id,
        blockers: [],
      })
    }
    return row
  }

  async #readHistory(id: ResumeId): Promise<readonly Revision[]> {
    const rows = await this.#database.select<DocumentRevisionRow>(
      'SELECT * FROM document_revision WHERE resume_id = $1 ORDER BY seq ASC',
      [id],
    )
    return rows.map(fromDocumentRevisionRow)
  }

  async #readSnapshots(id: ResumeId): Promise<readonly ResumeSnapshot[]> {
    const rows = await this.#database.select<ResumeSnapshotRow>(
      'SELECT * FROM resume_snapshot WHERE resume_id = $1 ORDER BY seq ASC',
      [id],
    )
    return rows.map(fromResumeSnapshotRow)
  }

  /**
   * The cursor carries no foreign key by design, so a pointer to a missing or
   * foreign revision is a storage fault rather than a null result: hydrating it
   * would invent a document state nobody wrote.
   */
  #requireCursor(row: ResumeRow, revisions: readonly Revision[]): Revision {
    const cursor = revisions.find((revision) => revision.id === row.current_revision_id)
    if (cursor === undefined) {
      throw new RowMappingError(
        'resume.current_revision_id',
        'names a revision that does not belong to this resume',
        row.current_revision_id,
      )
    }
    return cursor
  }
}

function groupByResumeId<TRow extends { readonly resume_id: string }>(
  rows: readonly TRow[],
): ReadonlyMap<string, TRow[]> {
  const grouped = new Map<string, TRow[]>()
  for (const row of rows) {
    const existing = grouped.get(row.resume_id)
    if (existing === undefined) {
      grouped.set(row.resume_id, [row])
    } else {
      existing.push(row)
    }
  }
  return grouped
}
