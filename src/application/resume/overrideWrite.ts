/**
 * @file overrideWrite
 * @description The shared rule behind writing a resume override, whether it is
 * the summary or an entry body. It keeps the identifier stable across rewrites
 * (the revision chain stays continuous), records agent provenance, and marks a
 * user's edit of agent text instead of creating a second override.
 *
 * Constraints:
 * - An agent write must name its run; a user write carries none.
 * - The text bounds and the one-override-per-target rule live in the domain.
 */

import type { AgentRunId, ResumeOverrideId } from '../../domain/shared/branded-id'
import { asResumeOverrideId } from '../../domain/shared/branded-id'
import type { DateTime } from '../../domain/shared/DateTime'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { OverrideTarget, ResumeOverride } from '../../domain/resume/ResumeOverride'
import { assertOverride } from '../../domain/resume/ResumeOverride'
import type { ChangeOrigin } from '../../domain/resume/DocumentState'
import { DomainError } from '../../domain/shared/DomainError'

export interface BuildOverrideInput {
  readonly existing: ResumeOverride | undefined
  readonly target: OverrideTarget
  readonly text: string
  readonly origin: ChangeOrigin
  readonly runId: AgentRunId | null
}

/**
 * Produces the override a write should store. A user write over existing text
 * keeps the original provenance and flips `editedByUser`; an agent rewrite takes
 * the text back over and clears the flag.
 */
export function buildOverride(
  ids: IdGenerator,
  now: DateTime,
  input: BuildOverrideInput,
): ResumeOverride {
  const text = input.text.trim()
  const createdAt = input.existing?.createdAt ?? now
  const id: ResumeOverrideId = input.existing?.id ?? asResumeOverrideId(ids.next())
  if (input.origin === 'agent') {
    if (input.runId === null) {
      throw new DomainError(
        'invalidFieldValue',
        'An agent write must name the run it came from.',
        { entity: 'resumeOverride', id, blockers: ['runId'] },
      )
    }
    const override: ResumeOverride = {
      id,
      target: input.target,
      text,
      origin: 'agent',
      sourceRunId: input.runId,
      editedByUser: false,
      createdAt,
      updatedAt: now,
    }
    assertOverride(override)
    return override
  }
  const override: ResumeOverride = {
    id,
    target: input.target,
    text,
    origin: input.existing?.origin ?? 'user',
    sourceRunId: input.existing?.origin === 'agent' ? input.existing.sourceRunId : null,
    editedByUser: true,
    createdAt,
    updatedAt: now,
  }
  assertOverride(override)
  return override
}
