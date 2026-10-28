/**
 * @file saveOverrideToLibrary
 * @description Writes a resume's customised entry text back into the shared
 * library entry, after the user confirms. The write goes through the information
 * library use case, so the entry keeps its own validation and change record; the
 * resume then records that the text is user-edited.
 *
 * Responsibilities:
 * - Resolve the entry, its module definition and the target textarea field
 * - Merge the override text into the field (replace or idempotent append)
 * - Update the entry through the injected library writer
 * - Mark the override `editedByUser` in one document revision
 *
 * Constraints:
 * - The two writes are deliberately not atomic: if the document commit fails the
 *   override is still stored and the retry is safe because append is idempotent.
 * - This use case never writes the information repository directly; the library
 *   use case owns that transaction and its change record.
 */

import type { CustomModuleRepository } from '../../domain/info/ports/CustomModuleRepository'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { InfoFieldValue } from '../../domain/info/InfoFieldValue'
import { fieldDescriptors } from '../../domain/info/InfoFieldValue'
import type { UpdateInfoEntryInput, UpdateInfoEntryOutput } from '../info/updateInfoEntry'
import type { ResumeId, ResumeOverrideId } from '../../domain/shared/branded-id'
import type { Clock } from '../../domain/shared/Clock'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeOverride } from '../../domain/resume/ResumeOverride'
import { DomainError } from '../../domain/shared/DomainError'
import type { ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export type OverrideLibraryMode = 'replace' | 'append'

export interface SaveOverrideToLibraryInput {
  readonly resumeId: ResumeId
  readonly overrideId: ResumeOverrideId
  readonly targetFieldKey: string
  readonly mode: OverrideLibraryMode
}

export interface SaveOverrideToLibraryDeps extends ResumeStoreDeps {
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  /** The information-library update use case, bound to its own dependencies. */
  readonly updateEntry: (input: UpdateInfoEntryInput) => Promise<UpdateInfoEntryOutput>
  readonly clock: Clock
}

export interface SaveOverrideToLibraryOutput {
  readonly override: ResumeOverride
  readonly revision: Revision
  readonly change: UpdateInfoEntryOutput['change']
}

export async function saveOverrideToLibrary(
  deps: SaveOverrideToLibraryDeps,
  input: SaveOverrideToLibraryInput,
): Promise<SaveOverrideToLibraryOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const override = resume.document.overrides.find((entry) => entry.id === input.overrideId)
  if (override === undefined) {
    throw new DomainError('overrideNotFound', 'The customised text does not exist.', {
      entity: 'resumeOverride',
      id: input.overrideId,
      blockers: [input.overrideId],
    })
  }
  if (override.target.kind !== 'entry') {
    throw new DomainError('unknownField', 'A summary has no library field to save into.', {
      entity: 'resumeOverride',
      id: input.overrideId,
      blockers: [input.targetFieldKey],
    })
  }
  const entry = await deps.entries.findById(override.target.entryId)
  if (entry === null) {
    throw new DomainError('entryNotFound', 'The entry the text belongs to no longer exists.', {
      entity: 'infoEntry',
      id: override.target.entryId,
      blockers: [override.target.entryId],
    })
  }
  const definition =
    entry.customModuleId === null ? null : await deps.customModules.findById(entry.customModuleId)
  const descriptor = fieldDescriptors(entry.moduleKind, definition).find(
    (field) => field.key === input.targetFieldKey,
  )
  if (descriptor === undefined || descriptor.type !== 'textarea') {
    throw new DomainError(
      'unknownField',
      `"${input.targetFieldKey}" is not a textarea field of this entry's module.`,
      {
        entity: 'infoEntry',
        id: entry.id,
        blockers: [input.targetFieldKey],
      },
    )
  }
  const current = entry.fields[input.targetFieldKey]
  const currentText = typeof current === 'string' ? current : ''
  const nextText =
    input.mode === 'replace' ? override.text : appendOnce(currentText, override.text)
  const fields: Record<string, InfoFieldValue> = {
    ...entry.fields,
    [input.targetFieldKey]: nextText,
  }
  const updated = await deps.updateEntry({ entryId: entry.id, fields })

  const saved: ResumeOverride = {
    ...override,
    editedByUser: true,
    updatedAt: deps.clock.now(),
  }
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('从简历保存回信息库'),
    next: (state) => ({
      ...state,
      overrides: state.overrides.map((candidate) =>
        candidate.id === saved.id ? saved : candidate,
      ),
    }),
  })
  return { override: saved, revision, change: updated.change }
}

/** Appends the text as a new line unless the field already carries it. */
function appendOnce(current: string, text: string): string {
  if (current.trim() === '') return text
  if (current.split(/\r\n|\r|\n/u).some((line) => line.trim() === text.trim())) return current
  return `${current}\n${text}`
}
