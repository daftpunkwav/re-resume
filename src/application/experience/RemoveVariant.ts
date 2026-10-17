/**
 * @file RemoveVariant
 * @description Deletes one variant, refused while any resume block still points
 * at it. Frozen snapshots keep the wording they materialized and are therefore
 * unaffected by the removal.
 *
 * Responsibilities:
 * - List the live blocks that reference the variant
 * - Refuse the removal with the referencing resumes and blocks named
 *
 * Constraints:
 * - Only the current live blocks of each resume count; a snapshot is
 *   materialized text and does not block anything.
 * - A variant that does not belong to the experience is refused by the
 *   aggregate with variantNotInExperience.
 */

import { removeVariant as removeVariantAggregate } from '../../domain/catalog/Experience'
import type { Clock } from '../../domain/shared/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ExperienceId, VariantId } from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import { isExperienceContent } from '../../domain/resume/Block'
import type { Resume } from '../../domain/resume/Resume'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'

export interface RemoveVariantDeps {
  readonly experienceRepo: ExperienceRepository
  readonly resumeRepo: ResumeRepository
  readonly clock: Clock
}

/**
 * A blank title would otherwise produce a blocker string that begins with
 * " / ". The id is the only label left in that case, and because the joined
 * string is never empty it always renders something the user can act on.
 */
function identifyResume(resume: Resume): string {
  return resume.title.trim() === '' ? resume.id : resume.title
}

export async function removeVariant(
  deps: RemoveVariantDeps,
  experienceId: ExperienceId,
  variantId: VariantId,
): Promise<void> {
  const experience = await deps.experienceRepo.findById(experienceId)
  if (experience === null) {
    throw new Error(`Cannot remove a variant of experience "${experienceId}": no such experience.`)
  }

  const resumes = await deps.resumeRepo.listAll()
  const blockers: string[] = []
  for (const resume of resumes) {
    for (const block of resume.blocks) {
      if (!isExperienceContent(block.content)) continue
      // Both ids must match: a block pointing at a same-id variant of another
      // experience is not blocked by this removal.
      if (block.content.experienceId !== experienceId) continue
      if (block.content.variantId !== variantId) continue
      blockers.push(`${identifyResume(resume)} / ${block.id}`)
    }
  }

  if (blockers.length > 0) {
    throw new DomainError(
      'referencedByBlocks',
      'This variant is still referenced by resume blocks. Point those blocks elsewhere before removing it.',
      { entity: 'variant', id: variantId, blockers },
    )
  }

  const updated = removeVariantAggregate(experience, variantId, deps.clock.now())
  await deps.experienceRepo.save(updated)
}
