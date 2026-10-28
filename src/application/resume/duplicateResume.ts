/**
 * @file duplicateResume
 * @description Copies a resume's current document into a brand-new draft. This
 * is the only iteration path a frozen resume has: there is no in-place unfreeze.
 *
 * Responsibilities:
 * - Regenerate every section, override and canvas-block identifier so the copy
 *   shares no editable structure with its source
 * - Keep entry identifiers unchanged: entries are shared facts, not copies
 * - Start the copy with its own initial revision: no history, no snapshots
 *
 * Constraints:
 * - A frozen source is duplicable on purpose; freezing is not a barrier here.
 * - The copy is written with its first revision in one transaction, because a
 *   resume that exists only in a caller's memory is not yet usable.
 */

import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { Clock } from '../../domain/shared/Clock'
import type { ResumeDocumentState } from '../../domain/resume/DocumentState'
import type { Resume } from '../../domain/resume/Resume'
import { normalizeResumeTitle } from '../../domain/resume/Resume'
import { INITIAL_REVISION_LABEL } from '../../domain/resume/Revision'
import type { Revision } from '../../domain/resume/Revision'
import type { TemplateDefinition } from '../../domain/resume/Template'
import { getTemplate } from '../../domain/resume/Template'
import { asResumeId, asResumeOverrideId, asCanvasBlockId, asResumeSectionId, asRevisionId } from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import { countCodePoints } from '../../domain/info/codePoints'
import type { ResumeId, RevisionId } from '../../domain/shared/branded-id'
import type { ResumeStoreDeps } from './resumeSource'
import { loadResume, changeMeta } from './resumeSource'

/** Suffix the default title of a copy carries. */
const COPY_SUFFIX = '（副本）'

export interface DuplicateResumeInput {
  readonly sourceResumeId: ResumeId
  /** Defaults to the source title marked as a copy. */
  readonly title?: string
}

export interface DuplicateResumeOutput {
  readonly resumeId: ResumeId
  readonly revisionId: RevisionId
}

export interface DuplicateResumeDeps extends ResumeStoreDeps {
  readonly ids: IdGenerator
  readonly clock: Clock
}

export async function duplicateResume(
  deps: DuplicateResumeDeps,
  input: DuplicateResumeInput,
): Promise<DuplicateResumeOutput> {
  const source = await loadResume(deps.resumes, input.sourceResumeId)
  requireTemplate(source)
  const now = deps.clock.now()
  const resumeId = asResumeId(deps.ids.next())
  const revisionId = asRevisionId(deps.ids.next())
  const document = copyDocument(source.document, deps.ids)
  const title =
    input.title === undefined ? copyTitle(source.title) : normalizeResumeTitle(input.title)

  const resume: Resume = {
    id: resumeId,
    title,
    targetJob: source.targetJob,
    status: 'draft',
    document,
    currentRevision: revisionId,
    snapshots: [],
    conversationId: null,
    createdAt: now,
    updatedAt: now,
  }
  const revision: Revision = {
    id: revisionId,
    resumeId,
    seq: 1,
    ...changeMeta(INITIAL_REVISION_LABEL),
    state: document,
    supersededAt: null,
    createdAt: now,
  }
  await deps.resumes.insertWithInitialRevision(resume, revision)
  return { resumeId, revisionId }
}

/** The copy keeps the source template; a template this build no longer has is refused. */
function requireTemplate(source: Resume): TemplateDefinition {
  const template = getTemplate(source.document.templateId)
  if (template === null) {
    throw new DomainError(
      'templateNotFound',
      'The source resume uses a template this build does not carry.',
      { entity: 'resume', id: source.id, blockers: [source.document.templateId] },
    )
  }
  return template
}

/**
 * Re-signs every structure identifier while copying positions, order and
 * content verbatim. Entry identifiers travel unchanged; so do the stored
 * entry-override targets, which still name the same library entries.
 */
function copyDocument(state: ResumeDocumentState, ids: IdGenerator): ResumeDocumentState {
  return {
    ...state,
    sections: state.sections.map((section) => ({
      ...section,
      id: asResumeSectionId(ids.next()),
      entryIds: [...section.entryIds],
    })),
    overrides: state.overrides.map((override) => ({
      ...override,
      id: asResumeOverrideId(ids.next()),
      target:
        override.target.kind === 'entry'
          ? { kind: 'entry' as const, entryId: override.target.entryId }
          : { kind: 'summary' as const },
    })),
    canvas: {
      freeBlocks: state.canvas.freeBlocks.map((block) => ({
        ...block,
        id: asCanvasBlockId(ids.next()),
      })),
    },
  }
}

/** `${title}（副本）`, shortened to the title bound when the source is at it. */
function copyTitle(sourceTitle: string): string {
  const copy = `${sourceTitle}${COPY_SUFFIX}`
  if (countCodePoints(copy) <= 80) return copy
  return [...copy].slice(0, 80).join('')
}
