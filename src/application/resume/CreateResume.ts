/**
 * @file CreateResume
 * @description Creates one resume together with its initial revision. The two
 * rows must appear together: a resume whose cursor points at a revision that
 * was never written cannot be hydrated, undone or trimmed.
 *
 * Responsibilities:
 * - Allocate the resume and initial revision identifiers from the injected generator
 * - Seed the document empty, with A4 page setup and the initial revision label
 *
 * Constraints:
 * - The document starts empty. Copying the profile into a leading block is the
 *   draft path's decision, not this use case's.
 * - ResumeRepository declares no create member, so the atomic creation pair is
 *   declared here as the narrow capability this use case depends on.
 */

// Aliased: this module exports the create-resume use case, and the aggregate's
// own factory has the same name.
import { createResume as createResumeAggregate } from '../../domain/resume/Resume'
import type { Resume } from '../../domain/resume/Resume'
import { INITIAL_REVISION_LABEL } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import { A4_PAGE_SETUP } from '../../domain/resume/PageSetup'
import type { DocumentState } from '../../domain/resume/DocumentChange'
import type { Clock } from '../../domain/catalog/ports/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import {
  asResumeId,
  asRevisionId,
} from '../../domain/shared/branded-id'
import type { ResumeId } from '../../domain/shared/branded-id'

export interface CreateResumeInput {
  readonly title: string
  readonly targetRole: string | null
}

/** Insertion of a resume row and its first revision as one unit of work. */
export interface ResumeCreation {
  insertWithInitialRevision(resume: Resume, revision: Revision): Promise<void>
}

export async function createResume(
  resumeCreation: ResumeCreation,
  ids: IdGenerator,
  clock: Clock,
  input: CreateResumeInput,
): Promise<ResumeId> {
  const now = clock.now()
  const resumeId = asResumeId(ids.next())
  const initialRevisionId = asRevisionId(ids.next())
  const state: DocumentState = { blocks: [], pageSetup: A4_PAGE_SETUP }
  const resume = createResumeAggregate(
    {
      id: resumeId,
      title: input.title,
      targetRole: input.targetRole,
      pageSetup: A4_PAGE_SETUP,
      initialRevisionId,
    },
    now,
  )
  const initial: Revision = {
    id: initialRevisionId,
    resumeId,
    seq: 1,
    label: INITIAL_REVISION_LABEL,
    origin: 'user',
    runId: null,
    state,
    supersededAt: null,
    createdAt: now,
  }
  await resumeCreation.insertWithInitialRevision(resume, initial)
  return resumeId
}
