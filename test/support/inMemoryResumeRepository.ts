/**
 * @file inMemoryResumeRepository
 * @description In-memory resume repository for use case tests. It reproduces the
 * persistence contract — revision cursor, branch supersession, trim rule — and
 * nothing from SQL. The same contract is exercised against SQLite separately in
 * the infrastructure tests.
 */

import { DomainError } from '../../src/domain/shared/DomainError'
import { INITIAL_REVISION_LABEL, nextSeq } from '../../src/domain/resume/Revision'
import type { Revision } from '../../src/domain/resume/Revision'
import type { Resume } from '../../src/domain/resume/Resume'
import { assertFrozenHasSnapshot } from '../../src/domain/resume/Resume'
import type { ResumeSnapshot } from '../../src/domain/resume/ResumeSnapshot'
import type { DocumentChangeMeta, DocumentState } from '../../src/domain/resume/DocumentChange'
import type { ResumeRepository } from '../../src/domain/resume/ports/ResumeRepository'
import type { DateTime } from '../../src/domain/shared/DateTime'
import type { ResumeId, RevisionId } from '../../src/domain/shared/branded-id'
import { asRevisionId } from '../../src/domain/shared/branded-id'

export const DEFAULT_REVISION_LIMIT = 200

export class InMemoryResumeRepository implements ResumeRepository {
  private readonly resumes = new Map<ResumeId, Resume>()
  private readonly revisions = new Map<RevisionId, Revision>()
  #revisionSerial = 0

  constructor(
    private readonly clock: () => DateTime,
    private readonly revisionLimit = DEFAULT_REVISION_LIMIT,
  ) {}

  async findById(id: ResumeId): Promise<Resume | null> {
    return this.resumes.get(id) ?? null
  }

  async listAll(): Promise<readonly Resume[]> {
    return [...this.resumes.values()]
  }

  async saveDocument(
    id: ResumeId,
    state: DocumentState,
    change: DocumentChangeMeta,
  ): Promise<Revision> {
    const resume = this.requireResume(id)
    if (resume.status === 'frozen') {
      throw new DomainError('frozenResumeImmutable', 'This resume is frozen.', {
        entity: 'resume',
        id,
        blockers: [],
      })
    }
    const history = this.historyOf(id)
    const cursor = this.requireRevision(resume.currentRevision)
    if (cursor.supersededAt !== null) {
      throw new DomainError('cursorNotOnLiveChain', 'The cursor sits on an abandoned branch.', {
        entity: 'resume',
        id,
        blockers: [],
      })
    }
    const now = this.clock()
    for (const revision of history) {
      if (revision.seq > cursor.seq && revision.supersededAt === null) {
        this.revisions.set(revision.id, { ...revision, supersededAt: now })
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
    this.revisions.set(revision.id, revision)
    this.resumes.set(id, {
      ...resume,
      blocks: state.blocks,
      pageSetup: state.pageSetup,
      currentRevision: revision.id,
      updatedAt: now,
    })
    this.trimHistory(id, revision.id)
    return revision
  }

  async moveCursor(id: ResumeId, revisionId: RevisionId): Promise<void> {
    const resume = this.requireResume(id)
    if (resume.status === 'frozen') {
      throw new DomainError('frozenResumeImmutable', 'This resume is frozen.', {
        entity: 'resume',
        id,
        blockers: [],
      })
    }
    const target = this.requireRevision(revisionId)
    if (target.resumeId !== id) {
      throw new DomainError('cursorNotOnLiveChain', 'Revision belongs to another resume.', {
        entity: 'resume',
        id,
        blockers: [revisionId],
      })
    }
    if (target.supersededAt !== null) {
      throw new DomainError(
        'cursorNotOnLiveChain',
        'The cursor may only sit on a live revision.',
        { entity: 'resume', id, blockers: [revisionId] },
      )
    }
    this.resumes.set(id, {
      ...resume,
      blocks: target.state.blocks,
      pageSetup: target.state.pageSetup,
      currentRevision: revisionId,
      updatedAt: this.clock(),
    })
  }

  async readRevision(id: RevisionId): Promise<Revision | null> {
    return this.revisions.get(id) ?? null
  }

  async appendSnapshot(snapshot: ResumeSnapshot): Promise<void> {
    const resume = this.requireResume(snapshot.resumeId)
    const next: Resume = {
      ...resume,
      status: 'frozen',
      snapshots: [...resume.snapshots, snapshot],
      updatedAt: snapshot.createdAt,
    }
    assertFrozenHasSnapshot(next)
    this.resumes.set(resume.id, next)
  }

  /** Seeds a resume together with its initial revision; mirrors CreateResume. */
  async insertWithInitialRevision(
    resume: Resume,
    revision: Revision,
  ): Promise<void> {
    this.resumes.set(resume.id, resume)
    this.revisions.set(revision.id, revision)
  }

  historyOf(id: ResumeId): readonly Revision[] {
    return [...this.revisions.values()]
      .filter((revision) => revision.resumeId === id)
      .sort((left, right) => left.seq - right.seq)
  }

  /**
   * Revision ids are minted from a counter, never derived from the cursor's
   * seq. Deriving them from seq would hand a committing-after-undo save the id
   * of the abandoned row it just superseded and overwrite it, destroying the
   * audit trail the model exists to keep.
   */
  #mintRevisionId(resumeId: ResumeId): RevisionId {
    this.#revisionSerial += 1
    return asRevisionId(`revision-${resumeId}-${this.#revisionSerial}`)
  }

  private trimHistory(id: ResumeId, cursorId: RevisionId): void {
    const history = this.historyOf(id)
    const live = history.filter((revision) => revision.supersededAt === null)
    if (live.length <= this.revisionLimit) return
    const cursor = this.requireRevision(cursorId)
    // Keep the newest window, but never cut past the cursor: redo must remain
    // reachable. The cut point is whichever starts later.
    const windowStart = live[live.length - this.revisionLimit]
    if (windowStart === undefined) return
    // Cut below whichever starts earlier: the window the limit allows, or the
    // cursor, which redo still has to reach.
    const cutBelow = Math.min(windowStart.seq, cursor.seq)
    for (const revision of live) {
      if (revision.seq < cutBelow) this.revisions.delete(revision.id)
    }
  }

  private requireResume(id: ResumeId): Resume {
    const resume = this.resumes.get(id)
    if (resume === undefined) {
      throw new DomainError('cursorNotOnLiveChain', 'No such resume.', {
        entity: 'resume',
        id,
        blockers: [],
      })
    }
    return resume
  }

  private requireRevision(id: RevisionId): Revision {
    const revision = this.revisions.get(id)
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

export function initialRevision(
  resumeId: ResumeId,
  revisionId: RevisionId,
  state: DocumentState,
  createdAt: DateTime,
): Revision {
  return {
    id: revisionId,
    resumeId,
    seq: 1,
    label: INITIAL_REVISION_LABEL,
    origin: 'user',
    runId: null,
    state,
    supersededAt: null,
    createdAt,
  }
}
