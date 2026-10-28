/**
 * @file SqliteResumeRepository
 * @description SQLite persistence for the resume aggregate: the pointer row, the
 * revision chain that doubles as its undo/redo history, and the frozen
 * snapshots.
 *
 * Constraints:
 * - `saveDocument` performs four steps — supersede the abandoned branch, append
 *   the new revision, move the cursor, trim — inside one transaction. Partial
 *   application is a contract violation.
 * - `seq` is max(seq) + 1 over the whole history including superseded rows, so a
 *   sequence number is never reused and UNIQUE (resume_id, seq) always holds.
 * - Trim never touches the cursor or anything reachable from it by redo, and
 *   never deletes a superseded row: abandoned branches are kept for audit.
 * - The repository never loads the whole history to hydrate one resume: only the
 *   revision the cursor names is read.
 * - Deleting a resume clears the cross-domain pointers that name it
 *   (`conversation.active_resume_id`, `agent_run.resume_id`), because the schema
 *   deliberately declares those columns without foreign keys.
 */

import { DomainError } from '../../../domain/shared/DomainError'
import { nextSeq } from '../../../domain/resume/Revision'
import type { Revision } from '../../../domain/resume/Revision'
import type { Resume } from '../../../domain/resume/Resume'
import type { ResumeSnapshot } from '../../../domain/resume/ResumeSnapshot'
import type { DocumentChangeMeta, ResumeDocumentState } from '../../../domain/resume/DocumentState'
import type {
  ResumeMetadataPatch,
  ResumeRepository,
} from '../../../domain/resume/ports/ResumeRepository'
import type { Clock } from '../../../domain/shared/Clock'
import type { IdGenerator } from '../../../domain/shared/IdGenerator'
import type { DateTime } from '../../../domain/shared/DateTime'
import type {
  ResumeId,
  RevisionId,
  SnapshotId,
} from '../../../domain/shared/branded-id'
import { asRevisionId } from '../../../domain/shared/branded-id'
import { RowMappingError, writeJsonEnvelope } from '../JsonEnvelope'
import {
  fromRevisionRow,
  fromSnapshotRow,
  hydrateResume,
  toResumeRow,
  toRevisionRow,
  toSnapshotRow,
} from './mappers/ResumeRowMapper'
import type {
  ResumeRevisionRow,
  ResumeRow,
  ResumeSnapshotRow,
} from './mappers/ResumeRowMapper'
import type { SqlDatabase } from '../sqlite'

/** How many live revisions one resume keeps; the newest window is preserved. */
export const DEFAULT_REVISION_LIMIT = 200

interface SeqRow {
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
    const cursor = await this.#readRevisionAt(row.current_revision_id, id)
    const snapshots = await this.#readSnapshots(id)
    return hydrateResume(row, cursor, snapshots)
  }

  async listAll(): Promise<readonly Resume[]> {
    const rows = await this.#database.select<ResumeRow>(
      'SELECT * FROM resume ORDER BY created_at ASC, id ASC',
    )
    if (rows.length === 0) return []
    const snapshotRows = await this.#database.select<ResumeSnapshotRow>(
      'SELECT * FROM resume_snapshot ORDER BY seq ASC',
    )
    const snapshotsByResume = groupByResumeId(snapshotRows)
    const cursors = await this.#database.select<ResumeRevisionRow>(
      `SELECT revision.* FROM resume_revision revision
       JOIN resume ON resume.current_revision_id = revision.id
       WHERE revision.resume_id = resume.id`,
    )
    const cursorById = new Map(cursors.map((row) => [row.id, fromRevisionRow(row)]))
    const resumes: Resume[] = []
    for (const row of rows) {
      const cursor = cursorById.get(row.current_revision_id)
      if (cursor === undefined) {
        throw new RowMappingError(
          'resume.current_revision_id',
          'names a revision that does not belong to this resume',
          row.current_revision_id,
        )
      }
      resumes.push(
        hydrateResume(
          row,
          cursor,
          (snapshotsByResume.get(row.id) ?? []).map(fromSnapshotRow),
        ),
      )
    }
    return resumes
  }

  async saveDocument(
    id: ResumeId,
    state: ResumeDocumentState,
    change: DocumentChangeMeta,
    expectedRevisionId: RevisionId,
  ): Promise<Revision> {
    return this.#database.transaction(async (tx) => {
      const resumeRow = await this.#requireResumeRow(tx, id)
      if (resumeRow.status === 'frozen') {
        throw new DomainError(
          'resumeFrozen',
          'A frozen resume cannot take another revision. Duplicate it to keep editing.',
          { entity: 'resume', id, blockers: [] },
        )
      }
      const history = await this.#readHistory(tx, id)
      const cursor = this.#requireCursor(resumeRow, history)
      if (cursor.id !== expectedRevisionId) {
        throw new DomainError(
          'revisionMismatch',
          'This resume took another revision while the change was being prepared. Reload it and try again.',
          { entity: 'resume', id, blockers: [expectedRevisionId, cursor.id] },
        )
      }
      if (cursor.supersededAt !== null) {
        throw new DomainError(
          'cursorNotOnLiveChain',
          'The cursor sits on an abandoned branch; a new change must start from the chain tail.',
          { entity: 'resume', id, blockers: [cursor.id] },
        )
      }
      const now = this.#clock.now()
      await tx.execute(
        `UPDATE resume_revision SET superseded_at = $1
         WHERE resume_id = $2 AND seq > $3 AND superseded_at IS NULL`,
        [now, id, cursor.seq],
      )
      const revision: Revision = {
        id: asRevisionId(this.#ids.next()),
        resumeId: id,
        seq: nextSeq(history),
        label: change.label,
        origin: change.origin,
        runId: change.runId,
        state,
        supersededAt: null,
        createdAt: now,
      }
      await this.#insertRevision(tx, revision)
      await tx.execute(
        'UPDATE resume SET current_revision_id = $1, updated_at = $2 WHERE id = $3',
        [revision.id, now, id],
      )
      await this.#trimHistory(tx, id, revision.id)
      return revision
    })
  }

  async moveCursor(id: ResumeId, revisionId: RevisionId): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const resumeRow = await this.#requireResumeRow(tx, id)
      if (resumeRow.status === 'frozen') {
        throw new DomainError(
          'resumeFrozen',
          'A frozen resume keeps the revision it was frozen at; its history is read-only.',
          { entity: 'resume', id, blockers: [] },
        )
      }
      const targets = await tx.select<ResumeRevisionRow>(
        'SELECT * FROM resume_revision WHERE id = $1',
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
      await tx.execute(
        'UPDATE resume SET current_revision_id = $1, updated_at = $2 WHERE id = $3',
        [revisionId, this.#clock.now(), id],
      )
    })
  }

  async findSnapshotById(id: SnapshotId): Promise<ResumeSnapshot | null> {
    const rows = await this.#database.select<ResumeSnapshotRow>(
      'SELECT * FROM resume_snapshot WHERE id = $1',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : fromSnapshotRow(row)
  }

  async listRevisions(id: ResumeId): Promise<readonly Revision[]> {
    return this.#readHistory(this.#database, id)
  }

  async readRevision(id: RevisionId): Promise<Revision | null> {
    const rows = await this.#database.select<ResumeRevisionRow>(
      'SELECT * FROM resume_revision WHERE id = $1',
      [id],
    )
    const row = rows[0]
    return row === undefined ? null : fromRevisionRow(row)
  }

  /**
   * Freezing is two writes: the snapshot that justifies the status, and the
   * status itself. Both land in one transaction, so a frozen resume without its
   * snapshot is unreachable rather than merely unlikely.
   */
  async appendSnapshot(
    snapshot: ResumeSnapshot,
    expectedRevisionId: RevisionId,
  ): Promise<void> {
    const row = toSnapshotRow(snapshot)
    await this.#database.transaction(async (tx) => {
      const resumeRow = await this.#requireResumeRow(tx, snapshot.resumeId)
      if (resumeRow.status === 'frozen') {
        throw new DomainError(
          'resumeFrozen',
          'This resume is already frozen and keeps the snapshot it was frozen at.',
          { entity: 'resume', id: snapshot.resumeId, blockers: [] },
        )
      }
      if (resumeRow.current_revision_id !== expectedRevisionId) {
        throw new DomainError(
          'revisionMismatch',
          'This resume took another revision while it was being finalized. Reload it and try again.',
          { entity: 'resume', id: snapshot.resumeId, blockers: [expectedRevisionId] },
        )
      }
      await tx.execute(
        `INSERT INTO resume_snapshot
           (id, resume_id, seq, frozen_state_json, materialized_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          row.id,
          row.resume_id,
          row.seq,
          row.frozen_state_json,
          row.materialized_json,
          row.created_at,
        ],
      )
      await tx.execute(
        `UPDATE resume SET status = $1, updated_at = $2
         WHERE id = $3 AND current_revision_id = $4 AND status = $5`,
        ['frozen', snapshot.createdAt, snapshot.resumeId, expectedRevisionId, 'draft'],
      )
      // The row was locked by BEGIN IMMEDIATE and checked above; a zero count
      // here would mean the plan the use case materialized is no longer the
      // frozen state, so the snapshot must not commit either.
      const updated = await tx.select<{ id: string }>(
        'SELECT id FROM resume WHERE id = $1 AND status = $2',
        [snapshot.resumeId, 'frozen'],
      )
      if (updated.length === 0) {
        throw new DomainError(
          'revisionMismatch',
          'This resume changed while it was being finalized. Reload it and try again.',
          { entity: 'resume', id: snapshot.resumeId, blockers: [expectedRevisionId] },
        )
      }
    })
  }

  /** resume row + its first revision, one transaction. */
  async insertWithInitialRevision(resume: Resume, revision: Revision): Promise<void> {
    const resumeRow = toResumeRow(resume)
    await this.#database.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO resume
           (id, title, target_job_json, status, current_revision_id, conversation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          resumeRow.id,
          resumeRow.title,
          resumeRow.target_job_json,
          resumeRow.status,
          resumeRow.current_revision_id,
          resumeRow.conversation_id,
          resumeRow.created_at,
          resumeRow.updated_at,
        ],
      )
      await this.#insertRevision(tx, revision)
    })
  }

  /**
   * Metadata direct write. Only the patch keys that are present are written, so
   * a title change cannot clear the target job.
   */
  async updateMetadata(id: ResumeId, patch: ResumeMetadataPatch, now: DateTime): Promise<void> {
    const assignments: string[] = ['updated_at = $1']
    const values: (string | number | null)[] = [now]
    if (patch.title !== undefined) {
      values.push(patch.title)
      assignments.push(`title = $${values.length.toString()}`)
    }
    if (patch.targetJob !== undefined) {
      values.push(patch.targetJob === null ? null : writeJsonEnvelope(patch.targetJob))
      assignments.push(`target_job_json = $${values.length.toString()}`)
    }
    if (patch.conversationId !== undefined) {
      values.push(patch.conversationId)
      assignments.push(`conversation_id = $${values.length.toString()}`)
    }
    values.push(id)
    const result = await this.#database.execute(
      `UPDATE resume SET ${assignments.join(', ')} WHERE id = $${values.length.toString()}`,
      values,
    )
    if (result.rowsAffected === 0) {
      throw new DomainError('resumeNotFound', 'The resume does not exist.', {
        entity: 'resume',
        id,
        blockers: [id],
      })
    }
  }

  /**
   * Deletes the resume; revisions and snapshots cascade. The conversation and
   * agent-run columns are bare text references in this schema, so they are
   * cleared explicitly in the same transaction.
   */
  async delete(id: ResumeId): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const result = await tx.execute('DELETE FROM resume WHERE id = $1', [id])
      if (result.rowsAffected === 0) {
        throw new DomainError('resumeNotFound', 'The resume does not exist.', {
          entity: 'resume',
          id,
          blockers: [id],
        })
      }
      await tx.execute(
        'UPDATE conversation SET active_resume_id = NULL WHERE active_resume_id = $1',
        [id],
      )
      await tx.execute('UPDATE agent_run SET resume_id = NULL WHERE resume_id = $1', [id])
    })
  }

  async #readRevisionAt(revisionId: string, resumeId: ResumeId): Promise<Revision> {
    const rows = await this.#database.select<ResumeRevisionRow>(
      'SELECT * FROM resume_revision WHERE id = $1 AND resume_id = $2',
      [revisionId, resumeId],
    )
    const row = rows[0]
    if (row === undefined) {
      throw new RowMappingError(
        'resume.current_revision_id',
        'names a revision that does not belong to this resume',
        revisionId,
      )
    }
    return fromRevisionRow(row)
  }

  async #insertRevision(tx: SqlDatabase, revision: Revision): Promise<void> {
    const row = toRevisionRow(revision)
    await tx.execute(
      `INSERT INTO resume_revision
         (id, resume_id, seq, label, origin, run_id, state_json, superseded_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.id,
        row.resume_id,
        row.seq,
        row.label,
        row.origin,
        row.run_id,
        row.state_json,
        row.superseded_at,
        row.created_at,
      ],
    )
  }

  /**
   * Keeps the newest limit live revisions. The delete bound is the older of the
   * window start and the cursor, so a cursor behind the window stretches the
   * window back to reach it: the cursor and everything reachable from it by redo
   * are never trimmed. Superseded rows are never deleted.
   */
  async #trimHistory(
    tx: SqlDatabase,
    resumeId: ResumeId,
    cursorRevisionId: RevisionId,
  ): Promise<void> {
    const liveRows = await tx.select<SeqRow>(
      `SELECT id, seq FROM resume_revision
       WHERE resume_id = $1 AND superseded_at IS NULL ORDER BY seq ASC`,
      [resumeId],
    )
    if (liveRows.length <= this.#revisionLimit) return
    const newest = liveRows.slice(-this.#revisionLimit)
    const cursor = liveRows.find((row) => row.id === cursorRevisionId)
    if (cursor === undefined) return
    const oldestKept = newest[0]
    if (oldestKept === undefined) return
    await tx.execute(
      `DELETE FROM resume_revision
       WHERE resume_id = $1 AND superseded_at IS NULL AND seq < $2`,
      [resumeId, Math.min(oldestKept.seq, cursor.seq)],
    )
  }

  async #requireResumeRow(tx: SqlDatabase, id: ResumeId): Promise<ResumeRow> {
    const rows = await tx.select<ResumeRow>('SELECT * FROM resume WHERE id = $1', [id])
    const row = rows[0]
    if (row === undefined) {
      throw new DomainError('resumeNotFound', 'The resume does not exist.', {
        entity: 'resume',
        id,
        blockers: [id],
      })
    }
    return row
  }

  async #readHistory(tx: SqlDatabase, id: ResumeId): Promise<readonly Revision[]> {
    const rows = await tx.select<ResumeRevisionRow>(
      'SELECT * FROM resume_revision WHERE resume_id = $1 ORDER BY seq ASC',
      [id],
    )
    return rows.map(fromRevisionRow)
  }

  async #readSnapshots(id: ResumeId): Promise<readonly ResumeSnapshot[]> {
    const rows = await this.#database.select<ResumeSnapshotRow>(
      'SELECT * FROM resume_snapshot WHERE resume_id = $1 ORDER BY seq ASC',
      [id],
    )
    return rows.map(fromSnapshotRow)
  }

  /**
   * The cursor carries no foreign key by design, so a pointer to a missing or
   * foreign revision is a storage fault rather than a null result.
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
    if (existing === undefined) grouped.set(row.resume_id, [row])
    else existing.push(row)
  }
  return grouped
}
