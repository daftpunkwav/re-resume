/**
 * @file inMemoryResumeRepository
 * @description Memory-backed implementation of the resume persistence port for
 * the browser preview and the use-case tests. It reproduces the observable
 * contract — revision cursor, branch supersession, trim rule, snapshot status —
 * without a database.
 *
 * Constraints:
 * - Preview and test support only; nothing here reaches disk.
 * - Values are stored by reference exactly as a row would keep columns, so
 *   callers treat what they read as immutable.
 */

import { DomainError } from '../../domain/shared/DomainError'
import type { Clock } from '../../domain/shared/Clock'
import type { DateTime } from '../../domain/shared/DateTime'
import { nextSeq } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import type { Resume } from '../../domain/resume/Resume'
import { assertFrozenHasSnapshot } from '../../domain/resume/Resume'
import type { ResumeSnapshot } from '../../domain/resume/ResumeSnapshot'
import type {
  DocumentChangeMeta,
  ResumeDocumentState,
} from '../../domain/resume/DocumentState'
import type {
  ResumeMetadataPatch,
  ResumeRepository,
} from '../../domain/resume/ports/ResumeRepository'
import type {
  ResumeId,
  RevisionId,
  SnapshotId,
} from '../../domain/shared/branded-id'
import { asRevisionId } from '../../domain/shared/branded-id'

export const DEFAULT_REVISION_LIMIT = 200

/** A resume and the revision its cursor names, for seeding fixtures. */
export interface SeededResume {
  readonly resume: Resume
  readonly revision: Revision
}

export class InMemoryResumeRepository implements ResumeRepository {
  readonly #resumes = new Map<string, Resume>()
  readonly #revisions = new Map<string, Revision>()
  readonly #clock: Clock
  readonly #revisionLimit: number
  #serial = 0

  constructor(clock: Clock, revisionLimit: number = DEFAULT_REVISION_LIMIT) {
    this.#clock = clock
    this.#revisionLimit = revisionLimit
  }

  /** Fills the store without producing revisions beyond the seeded one. */
  seed(entries: readonly SeededResume[]): void {
    for (const entry of entries) {
      this.#resumes.set(entry.resume.id, entry.resume)
      this.#revisions.set(entry.revision.id, entry.revision)
    }
  }

  async findById(id: ResumeId): Promise<Resume | null> {
    return this.#resumes.get(id) ?? null
  }

  async listAll(): Promise<readonly Resume[]> {
    return [...this.#resumes.values()].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0
        : left.createdAt < right.createdAt
          ? -1
          : 1,
    )
  }

  async findSnapshotById(id: SnapshotId): Promise<ResumeSnapshot | null> {
    for (const resume of this.#resumes.values()) {
      const snapshot = resume.snapshots.find((candidate) => candidate.id === id)
      if (snapshot !== undefined) return snapshot
    }
    return null
  }

  async saveDocument(
    id: ResumeId,
    state: ResumeDocumentState,
    change: DocumentChangeMeta,
    expectedRevisionId: RevisionId,
  ): Promise<Revision> {
    const resume = this.#requireResume(id)
    if (resume.status === 'frozen') {
      throw new DomainError('resumeFrozen', 'This resume is frozen.', {
        entity: 'resume',
        id,
        blockers: [],
      })
    }
    const history = this.#historyOf(id)
    const cursor = this.#requireRevision(resume.currentRevision)
    if (cursor.id !== expectedRevisionId) {
      throw new DomainError(
        'revisionMismatch',
        'This resume took another revision while the change was being prepared.',
        { entity: 'resume', id, blockers: [expectedRevisionId, cursor.id] },
      )
    }
    if (cursor.supersededAt !== null) {
      throw new DomainError('cursorNotOnLiveChain', 'The cursor sits on an abandoned branch.', {
        entity: 'resume',
        id,
        blockers: [cursor.id],
      })
    }
    const now = this.#clock.now()
    for (const revision of history) {
      if (revision.seq > cursor.seq && revision.supersededAt === null) {
        this.#revisions.set(revision.id, { ...revision, supersededAt: now })
      }
    }
    const revision: Revision = {
      id: this.#mintRevisionId(id),
      resumeId: id,
      seq: nextSeq(history),
      label: change.label,
      origin: change.origin,
      runId: change.runId,
      state,
      supersededAt: null,
      createdAt: now,
    }
    this.#revisions.set(revision.id, revision)
    this.#resumes.set(id, {
      ...resume,
      document: state,
      currentRevision: revision.id,
      updatedAt: now,
    })
    this.#trimHistory(id, revision.id)
    return revision
  }

  async moveCursor(id: ResumeId, revisionId: RevisionId): Promise<void> {
    const resume = this.#requireResume(id)
    if (resume.status === 'frozen') {
      throw new DomainError('resumeFrozen', 'This resume is frozen.', {
        entity: 'resume',
        id,
        blockers: [],
      })
    }
    const target = this.#requireRevision(revisionId)
    if (target.resumeId !== id || target.supersededAt !== null) {
      throw new DomainError('cursorNotOnLiveChain', 'The revision cannot become this cursor.', {
        entity: 'resume',
        id,
        blockers: [revisionId],
      })
    }
    this.#resumes.set(id, {
      ...resume,
      document: target.state,
      currentRevision: revisionId,
      updatedAt: this.#clock.now(),
    })
  }

  async readRevision(id: RevisionId): Promise<Revision | null> {
    return this.#revisions.get(id) ?? null
  }

  async listRevisions(id: ResumeId): Promise<readonly Revision[]> {
    return this.#historyOf(id)
  }

  async appendSnapshot(
    snapshot: ResumeSnapshot,
    expectedRevisionId: RevisionId,
  ): Promise<void> {
    const resume = this.#requireResume(snapshot.resumeId)
    if (resume.status === 'frozen') {
      throw new DomainError('resumeFrozen', 'This resume is already frozen.', {
        entity: 'resume',
        id: snapshot.resumeId,
        blockers: [],
      })
    }
    if (resume.currentRevision !== expectedRevisionId) {
      throw new DomainError('revisionMismatch', 'The resume moved while it was being frozen.', {
        entity: 'resume',
        id: snapshot.resumeId,
        blockers: [expectedRevisionId],
      })
    }
    const next: Resume = {
      ...resume,
      status: 'frozen',
      snapshots: [...resume.snapshots, snapshot],
      updatedAt: snapshot.createdAt,
    }
    assertFrozenHasSnapshot(next)
    this.#resumes.set(resume.id, next)
  }

  async insertWithInitialRevision(resume: Resume, revision: Revision): Promise<void> {
    this.#resumes.set(resume.id, resume)
    this.#revisions.set(revision.id, revision)
  }

  async updateMetadata(id: ResumeId, patch: ResumeMetadataPatch, now: DateTime): Promise<void> {
    const resume = this.#requireResume(id)
    this.#resumes.set(id, {
      ...resume,
      title: patch.title ?? resume.title,
      targetJob: patch.targetJob === undefined ? resume.targetJob : patch.targetJob,
      conversationId:
        patch.conversationId === undefined ? resume.conversationId : patch.conversationId,
      updatedAt: now,
    })
  }

  async delete(id: ResumeId): Promise<void> {
    this.#requireResume(id)
    this.#resumes.delete(id)
    for (const [revisionId, revision] of this.#revisions) {
      if (revision.resumeId === id) this.#revisions.delete(revisionId)
    }
  }

  /** The revision chain of one resume, ascending. */
  #historyOf(id: ResumeId): readonly Revision[] {
    return [...this.#revisions.values()]
      .filter((revision) => revision.resumeId === id)
      .sort((left, right) => left.seq - right.seq)
  }

  #mintRevisionId(resumeId: ResumeId): RevisionId {
    this.#serial += 1
    return asRevisionId(`revision-${resumeId}-${this.#serial}`)
  }

  #trimHistory(id: ResumeId, cursorId: RevisionId): void {
    const live = this.#historyOf(id).filter((revision) => revision.supersededAt === null)
    if (live.length <= this.#revisionLimit) return
    const cursor = this.#requireRevision(cursorId)
    const windowStart = live[live.length - this.#revisionLimit]
    if (windowStart === undefined) return
    const cutBelow = Math.min(windowStart.seq, cursor.seq)
    for (const revision of live) {
      if (revision.seq < cutBelow) this.#revisions.delete(revision.id)
    }
  }

  #requireResume(id: ResumeId): Resume {
    const resume = this.#resumes.get(id)
    if (resume === undefined) {
      throw new DomainError('resumeNotFound', 'The resume does not exist.', {
        entity: 'resume',
        id,
        blockers: [id],
      })
    }
    return resume
  }

  #requireRevision(id: RevisionId): Revision {
    const revision = this.#revisions.get(id)
    if (revision === undefined) {
      throw new DomainError('cursorNotOnLiveChain', 'No such revision.', {
        entity: 'resume',
        id: '',
        blockers: [id],
      })
    }
    return revision
  }
}
