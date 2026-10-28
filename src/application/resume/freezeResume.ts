/**
 * @file freezeResume
 * @description Freezing is the one explicit transition to an immutable resume:
 * the document is materialized into a snapshot and stops accepting changes.
 *
 * Responsibilities:
 * - Refuse a frozen resume and a cursor that has moved back from the newest live
 *   revision (finalizing would publish an undone state)
 * - Refuse a document without visible content or with unresolved references
 * - Materialize the document and append the snapshot that justifies the status
 * - Report overflows without refusing: a frozen resume may still overflow, and
 *   the interface decides how loudly to warn
 *
 * Constraints:
 * - Freezing never rewrites the live document; the snapshot is the frozen form,
 *   and duplication can still copy the live one.
 * - The snapshot and the status are written in one transaction (repository).
 */

import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { Clock } from '../../domain/shared/Clock'
import {
  assertFreezable,
  assertMutable,
} from '../../domain/resume/Resume'
import type { ResumeId, RevisionId } from '../../domain/shared/branded-id'
import { asSnapshotId } from '../../domain/shared/branded-id'
import type { OverflowReport } from '../../domain/resume/PageLayout'
import type { ResumeSnapshot } from '../../domain/resume/ResumeSnapshot'
import { nextSnapshotSeq } from '../../domain/resume/ResumeSnapshot'
import { DomainError } from '../../domain/shared/DomainError'
import type { FindMissingReferencesDeps } from './findMissingReferences'
import { missingReferencesOf } from './findMissingReferences'
import type { ResumeContentDeps } from './resumeSource'
import {
  loadMaterializedResume,
  loadResume,
} from './resumeSource'
import { liveRevisionChain } from './revisionChain'

export interface FreezeResumeDeps extends ResumeContentDeps, FindMissingReferencesDeps {
  readonly ids: IdGenerator
  readonly clock: Clock
}

export interface FreezeResumeOutput {
  readonly snapshot: ResumeSnapshot
  readonly overflows: readonly OverflowReport[]
}

export async function freezeResume(
  deps: FreezeResumeDeps,
  resumeId: ResumeId,
): Promise<FreezeResumeOutput> {
  const resume = await loadResume(deps.resumes, resumeId)
  assertMutable(resume)
  await assertCursorIsNewest(deps.resumes, resume.id, resume.currentRevision)
  assertFreezable(resume, await missingReferencesOf(deps, resume))

  const materialized = await loadMaterializedResume(deps, resume)
  const snapshot: ResumeSnapshot = {
    id: asSnapshotId(deps.ids.next()),
    resumeId: resume.id,
    seq: nextSnapshotSeq(resume.snapshots),
    frozenState: resume.document,
    materialized: materialized.document,
    createdAt: deps.clock.now(),
  }
  await deps.resumes.appendSnapshot(snapshot, resume.currentRevision)
  return { snapshot, overflows: materialized.layout.overflows }
}

/**
 * Only the newest live revision may be finalized: freezing after an undo would
 * publish a state the user already moved away from.
 */
async function assertCursorIsNewest(
  resumes: FreezeResumeDeps['resumes'],
  resumeId: ResumeId,
  cursor: RevisionId,
): Promise<void> {
  const chain = await liveRevisionChain(resumes, resumeId)
  const newest = chain[chain.length - 1]
  if (newest !== undefined && newest.id === cursor) return
  throw new DomainError(
    'cursorNotOnLiveChain',
    'Only the newest revision can be finalized; the cursor has been moved back.',
    { entity: 'resume', id: resumeId, blockers: [cursor] },
  )
}
