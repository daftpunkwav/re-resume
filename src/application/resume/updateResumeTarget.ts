/**
 * @file updateResumeTarget
 * @description Writes the job a resume is aimed at. Target metadata is not part
 * of the document state, so this creates no revision; the copied title and
 * company keep working after the posting they came from is gone.
 */

import type { TargetJob } from '../../domain/resume/TargetJob'
import { normalizeTargetJob } from '../../domain/resume/TargetJob'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { Clock } from '../../domain/shared/Clock'
import type { ResumeStoreDeps } from './resumeSource'
import { loadResume } from './resumeSource'

export interface UpdateResumeTargetInput {
  readonly resumeId: ResumeId
  readonly targetJob: TargetJob | null
}

export interface UpdateResumeTargetDeps extends ResumeStoreDeps {
  readonly clock: Clock
}

export async function updateResumeTarget(
  deps: UpdateResumeTargetDeps,
  input: UpdateResumeTargetInput,
): Promise<void> {
  const targetJob = input.targetJob === null ? null : normalizeTargetJob(input.targetJob)
  await loadResume(deps.resumes, input.resumeId)
  await deps.resumes.updateMetadata(
    input.resumeId,
    { targetJob },
    deps.clock.now(),
  )
}
