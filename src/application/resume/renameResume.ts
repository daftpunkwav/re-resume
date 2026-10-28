/**
 * @file renameResume
 * @description Renames a resume. The title is metadata, not document state, so
 * the write goes straight to the row and creates no revision: renaming does not
 * belong in the edit history.
 */

import { normalizeResumeTitle } from '../../domain/resume/Resume'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { Clock } from '../../domain/shared/Clock'
import type { ResumeStoreDeps } from './resumeSource'
import { loadResume } from './resumeSource'

export interface RenameResumeInput {
  readonly resumeId: ResumeId
  readonly title: string
}

export interface RenameResumeDeps extends ResumeStoreDeps {
  readonly clock: Clock
}

export async function renameResume(deps: RenameResumeDeps, input: RenameResumeInput): Promise<void> {
  const title = normalizeResumeTitle(input.title)
  await loadResume(deps.resumes, input.resumeId)
  await deps.resumes.updateMetadata(input.resumeId, { title }, deps.clock.now())
}
