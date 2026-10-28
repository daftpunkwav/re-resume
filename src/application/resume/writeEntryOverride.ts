/**
 * @file writeEntryOverride
 * @description Rewrites the rendered body of one library entry inside one
 * resume. The entry itself is untouched: the override is the resume's tailored
 * text, stored separately from the shared facts.
 *
 * Constraints:
 * - An entry may be missing when the override is written; the text then waits in
 *   the document until the entry returns (and is reported as a missing
 *   reference).
 * - One override per entry: a rewrite replaces the existing text in place.
 * - The change goes through `commitResumeChange`, so it is one revision.
 */

import type { InfoEntryId, ResumeId } from '../../domain/shared/branded-id'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeOverride } from '../../domain/resume/ResumeOverride'
import { findOverrideByTarget, replaceOverride } from '../../domain/resume/ResumeOverride'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'
import { buildOverride } from './overrideWrite'

export interface WriteEntryOverrideInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly entryId: InfoEntryId
  readonly text: string
}

export interface WriteEntryOverrideDeps extends ResumeStoreDeps {
  readonly ids: IdGenerator
  readonly clock: Clock
}

export interface WriteEntryOverrideOutput {
  readonly override: ResumeOverride
  readonly revision: Revision
}

export async function writeEntryOverride(
  deps: WriteEntryOverrideDeps,
  input: WriteEntryOverrideInput,
): Promise<WriteEntryOverrideOutput> {
  const target = { kind: 'entry' as const, entryId: input.entryId }
  const resume = await loadResume(deps.resumes, input.resumeId)
  const meta = changeMeta('改写条目文案', input)
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
