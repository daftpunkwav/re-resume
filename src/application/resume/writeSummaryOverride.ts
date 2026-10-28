/**
 * @file writeSummaryOverride
 * @description Writes the job-specific summary the reader meets before the first
 * chapter. A resume holds at most one summary: a second write replaces the first
 * in place, keeping its identifier so the history stays continuous.
 *
 * Constraints:
 * - The text is bounded by the domain summary limit (4000 code points).
 * - The change goes through `commitResumeChange`, so the summary is one revision.
 */

import type { ResumeId } from '../../domain/shared/branded-id'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeOverride } from '../../domain/resume/ResumeOverride'
import { findOverrideByTarget, replaceOverride } from '../../domain/resume/ResumeOverride'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'
import { buildOverride } from './overrideWrite'

export interface WriteSummaryOverrideInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly text: string
}

export interface WriteSummaryOverrideDeps extends ResumeStoreDeps {
  readonly ids: IdGenerator
  readonly clock: Clock
}

export interface WriteSummaryOverrideOutput {
  readonly override: ResumeOverride
  readonly revision: Revision
}

export async function writeSummaryOverride(
  deps: WriteSummaryOverrideDeps,
  input: WriteSummaryOverrideInput,
): Promise<WriteSummaryOverrideOutput> {
  const target = { kind: 'summary' as const }
  const resume = await loadResume(deps.resumes, input.resumeId)
  const meta = changeMeta('撰写岗位总结', input)
  const override = buildOverride(deps.ids, deps.clock.now(), {
    existing: findOverrideByTarget(resume.document.overrides, target),
    target,
    text: input.text,
    origin: meta.origin,
    runId: meta.runId,
  })
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...meta,
    next: (state) => ({
      ...state,
      overrides: replaceOverride(state.overrides, override),
    }),
  })
  return { override, revision }
}
