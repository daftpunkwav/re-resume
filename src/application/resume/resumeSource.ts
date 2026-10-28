/**
 * @file resumeSource
 * @description The dependency records and shared rules of the resume use cases,
 * plus the one loader that turns a stored resume into what a query needs. Every
 * use case is a function over these records; none constructs infrastructure or
 * reads the environment.
 *
 * Responsibilities:
 * - Declare the store, content and provenance dependencies
 * - Load a resume or refuse with the contract's error code
 * - Build the materializer input from the resume and the library
 * - Resolve the revision metadata an agent or user write records
 *
 * Constraints:
 * - Only ports and domain values appear in the dependency records.
 * - The resume model imports the library only through its ports; it never
 *   touches storage directly.
 */

import type { CustomModuleDefinition } from '../../domain/info/CustomModule'
import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { DocumentChangeMeta, ChangeOrigin } from '../../domain/resume/DocumentState'
import type { Resume } from '../../domain/resume/Resume'
import type { TemplateDefinition } from '../../domain/resume/Template'
import { resolveTemplate } from '../../domain/resume/Template'
import type { TextMeasurer } from '../../domain/resume/ports/TextMeasurer'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { LayoutOutput } from '../../domain/resume/PageLayout'
import type { MaterializedDocument } from '../../domain/resume/ResumeSnapshot'
import { DomainError } from '../../domain/shared/DomainError'
import type { AgentRunId, ResumeId } from '../../domain/shared/branded-id'
import type { MaterializeInput } from './materializeDocument'
import {
  layoutMaterializedDocument,
  materializeDocument,
} from './materializeDocument'

/** The resume store every use case writes through. */
export interface ResumeStoreDeps {
  readonly resumes: ResumeRepository
}

/** The library values a resume renders, plus the measurer its layout needs. */
export interface ResumeContentDeps extends ResumeStoreDeps {
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly measurer: TextMeasurer
}

/** Who performed a document write. Defaults to the user. */
export interface ChangeProvenance {
  readonly origin?: ChangeOrigin
  readonly runId?: AgentRunId | null
}

/** The materialized document together with the geometry a query reports. */
export interface MaterializedResume {
  readonly input: MaterializeInput
  readonly document: MaterializedDocument
  readonly layout: LayoutOutput
}

export function resumeNotFound(id: ResumeId): DomainError {
  return new DomainError('resumeNotFound', 'The resume does not exist.', {
    entity: 'resume',
    id,
    blockers: [id],
  })
}

/** Loads the aggregate or throws the contract's not-found code. */
export async function loadResume(
  resumes: ResumeRepository,
  resumeId: ResumeId,
): Promise<Resume> {
  const resume = await resumes.findById(resumeId)
  if (resume === null) throw resumeNotFound(resumeId)
  return resume
}

/** The template the document is rendered with; unknown ids fall back. */
export function templateOf(resume: Resume): TemplateDefinition {
  return resolveTemplate(resume.document.templateId)
}

/**
 * Builds the materializer input by reading the whole library. The library is a
 * few dozen rows and a resume can select any of them, so one read is cheaper
 * than asking per referenced entry.
 */
export async function materializeInputOf(
  deps: ResumeContentDeps,
  resume: Resume,
): Promise<MaterializeInput> {
  const [entries, customModules] = await Promise.all([
    deps.entries.listAll(),
    deps.customModules.listAll(),
  ])
  return {
    resume,
    entries: new Map<string, InfoEntry>(entries.map((entry) => [entry.id, entry])),
    customModules: new Map<string, CustomModuleDefinition>(
      customModules.map((module) => [module.id, module]),
    ),
    template: templateOf(resume),
    measurer: deps.measurer,
  }
}

/** Materializes and lays a resume out in one step, for the read queries. */
export async function loadMaterializedResume(
  deps: ResumeContentDeps,
  resume: Resume,
): Promise<MaterializedResume> {
  const input = await materializeInputOf(deps, resume)
  const document = materializeDocument(input)
  return { input, document, layout: layoutMaterializedDocument(input, document.blocks) }
}

/**
 * Resolves the revision metadata a write records, enforcing the provenance
 * invariant: an agent write names the run it came from; a user write names none.
 *
 * @throws DomainError `invalidFieldValue` for an agent write without a run.
 */
export function changeMeta(label: string, provenance: ChangeProvenance = {}): DocumentChangeMeta {
  const origin = provenance.origin ?? 'user'
  if (origin === 'agent') {
    const runId = provenance.runId ?? null
    if (runId === null) {
      throw new DomainError(
        'invalidFieldValue',
        'An agent write must name the run it came from.',
        { entity: 'resume', id: '', blockers: ['runId'] },
      )
    }
    return { label, origin, runId }
  }
  return { label, origin: 'user', runId: null }
}
