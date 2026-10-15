/**
 * @file DeleteExperience
 * @description Deletes one experience, refused while any resume block still
 * points at it. Variants and claims follow by cascade; frozen snapshots are
 * unaffected because they hold materialized text rather than references.
 *
 * Responsibilities:
 * - List the live blocks that reference the experience
 * - Refuse the deletion with the referencing resumes and blocks named
 *
 * Constraints:
 * - Only the current live blocks of each resume count. A snapshot is
 *   materialized text and does not block anything.
 * - The refusal carries the code referencedByBlocks and lists "<resume> /
 *   <blockId>" pairs, so the caller can name what to unlink instead of
 *   receiving a bare failure.
 */

import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ExperienceId } from '../../domain/shared/branded-id'
import { DomainError } from '../../domain/shared/DomainError'
import { isExperienceContent } from '../../domain/resume/Block'
import type { Resume } from '../../domain/resume/Resume'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'

export interface DeleteExperienceDeps {
  readonly experienceRepo: ExperienceRepository
  readonly resumeRepo: ResumeRepository
}

/**
 * A blank title would otherwise produce a blocker string that begins with
 * " / ". The id is the only label left in that case, and because the joined
 * string is never empty it always renders something the user can act on.
 */
function identifyResume(resume: Resume): string {
  return resume.title.trim() === '' ? resume.id : resume.title
}

export async function deleteExperience(
  deps: DeleteExperienceDeps,
  experienceId: ExperienceId,
): Promise<void> {
  const experience = await deps.experienceRepo.findById(experienceId)
  if (experience === null) {
    throw new Error(`Cannot delete experience "${experienceId}": no such experience.`)
  }

  const resumes = await deps.resumeRepo.listAll()
  const blockers: string[] = []
  for (const resume of resumes) {
    for (const block of resume.blocks) {
      if (!isExperienceContent(block.content)) continue
      if (block.content.experienceId !== experienceId) continue
      blockers.push(`${identifyResume(resume)} / ${block.id}`)
    }
  }

  if (blockers.length > 0) {
    throw new DomainError(
      'referencedByBlocks',
      'This experience is still referenced by resume blocks. Unlink them before deleting it.',
      { entity: 'experience', id: experienceId, blockers },
    )
  }

  await deps.experienceRepo.remove(experienceId)
}
