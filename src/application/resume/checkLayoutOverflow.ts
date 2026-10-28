/**
 * @file checkLayoutOverflow
 * @description Reports the page count and the overflow list the current document
 * produces. Used by the agent before proposing a composition and by the
 * interface before an export so the user is warned rather than surprised.
 *
 * Constraints:
 * - Read-only: no revision, no change record.
 * - The layout is recomputed from the materialized blocks, so the report matches
 *   what the canvas shows.
 */

import type { OverflowReport } from '../../domain/resume/PageLayout'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { ResumeContentDeps } from './resumeSource'
import { loadMaterializedResume, loadResume } from './resumeSource'

export interface CheckLayoutOverflowInput {
  readonly resumeId: ResumeId
}

export interface CheckLayoutOverflowOutput {
  readonly pageCount: number
  readonly overflows: readonly OverflowReport[]
}

export async function checkLayoutOverflow(
  deps: ResumeContentDeps,
  input: CheckLayoutOverflowInput,
): Promise<CheckLayoutOverflowOutput> {
  const resume = await loadResume(deps.resumes, input.resumeId)
  const materialized = await loadMaterializedResume(deps, resume)
  return {
    pageCount: materialized.layout.pages.length,
    overflows: materialized.layout.overflows,
  }
}
