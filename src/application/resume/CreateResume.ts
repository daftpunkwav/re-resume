/**
 * @file CreateResume
 * @description Creates one resume together with its initial revision. The two
 * rows must appear together: a resume whose cursor points at a revision that
 * was never written cannot be hydrated, undone or trimmed.
 *
 * Responsibilities:
 * - Allocate the resume and initial revision identifiers from the injected generator
 * - Write the resume row and the revision it opens with as one unit
 *
 * Constraints:
 * - A resume the user creates by hand starts empty. Seeding it with content is
 *   the caller's decision — a copy of another document and an agent draft both
 *   arrive with blocks they have already assembled.
 * - ResumeRepository declares no create member, so the atomic creation pair is
 *   declared here as the narrow capability this use case depends on.
 */

// Aliased: this module exports the create-resume use case, and the aggregate's
// own factory has the same name.
import { createResume as createResumeAggregate, setDocument } from '../../domain/resume/Resume'
import type { Resume } from '../../domain/resume/Resume'
import { INITIAL_REVISION_LABEL } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import { A4_PAGE_SETUP } from '../../domain/resume/PageSetup'
import type { DocumentChangeMeta, DocumentState } from '../../domain/resume/DocumentChange'
import type { Clock } from '../../domain/catalog/ports/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { AgentRunId } from '../../domain/shared/branded-id'
import { asResumeId, asRevisionId } from '../../domain/shared/branded-id'
import type { ResumeId } from '../../domain/shared/branded-id'

export interface CreateResumeInput {
  readonly title: string
  readonly targetRole: string | null
}

/** Insertion of a resume row and its first revision as one unit of work. */
export interface ResumeCreation {
  insertWithInitialRevision(resume: Resume, revision: Revision): Promise<void>
}

/** How the opening revision is attributed in the history the user sees. */
export interface InitialRevisionProvenance {
  readonly label: string
  readonly origin: DocumentChangeMeta['origin']
  readonly runId: AgentRunId | null
}

export interface CreateResumeFromDocumentInput {
  readonly title: string
  readonly targetRole: string | null
  readonly document: DocumentState
  readonly provenance: InitialRevisionProvenance
}

export async function createResume(
  resumeCreation: ResumeCreation,
  ids: IdGenerator,
  clock: Clock,
  input: CreateResumeInput,
): Promise<ResumeId> {
  return createResumeFromDocument(resumeCreation, ids, clock, {
    title: input.title,
    targetRole: input.targetRole,
    document: { blocks: [], pageSetup: A4_PAGE_SETUP },
    provenance: {
      label: INITIAL_REVISION_LABEL,
      origin: 'user',
      runId: null,
    },
  })
}

/**
 * Creates a resume whose opening revision already carries a document. A copy
 * of an existing resume and an agent-assembled draft differ only in which
 * blocks they seed and who the change is attributed to; both are written with
 * the resume row in a single call, so a draft that fails validation leaves
 * nothing behind rather than an empty resume with no way to tell it apart from
 * one the user made by hand.
 */
export async function createResumeFromDocument(
  resumeCreation: ResumeCreation,
  ids: IdGenerator,
  clock: Clock,
  input: CreateResumeFromDocumentInput,
): Promise<ResumeId> {
  const now = clock.now()
  const resumeId = asResumeId(ids.next())
  const initialRevisionId = asRevisionId(ids.next())
  const resume = setDocument(
    createResumeAggregate(
      {
        id: resumeId,
        title: input.title,
        targetRole: input.targetRole,
        pageSetup: input.document.pageSetup,
        initialRevisionId,
      },
      now,
    ),
    input.document,
    initialRevisionId,
    now,
  )
  const initial: Revision = {
    id: initialRevisionId,
    resumeId,
    seq: 1,
    label: input.provenance.label,
    origin: input.provenance.origin,
    runId: input.provenance.runId,
    state: input.document,
    supersededAt: null,
    createdAt: now,
  }
  await resumeCreation.insertWithInitialRevision(resume, initial)
  return resumeId
}
