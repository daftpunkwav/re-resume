/**
 * @file deleteResume
 * @description Deletes a resume. Confirmation is the interface's job; this use
 * case assumes it happened. Revisions and snapshots cascade, and the
 * cross-domain pointers that name the resume are cleared so no conversation or
 * run keeps a dangling identifier.
 */

import type { ResumeId } from '../../domain/shared/branded-id'
import type { ResumeStoreDeps } from './resumeSource'
import { loadResume } from './resumeSource'

export async function deleteResume(deps: ResumeStoreDeps, resumeId: ResumeId): Promise<void> {
  await loadResume(deps.resumes, resumeId)
  await deps.resumes.delete(resumeId)
}
