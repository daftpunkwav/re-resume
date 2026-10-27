/**
 * @file loadResumeExperiences
 * @description Reads the experiences a resume's blocks cite, once per resume.
 * The loaded set is what the claim-status scan and the materialization both
 * read, so the two cannot disagree about a claim.
 *
 * Responsibilities:
 * - Read every experience an experience block references, at most once
 * - Refuse a block whose experience no longer exists
 *
 * Constraints:
 * - Only an experience block costs a read: the other block types carry their
 *   own content.
 * - The set is a snapshot of the library at load time. A claim rejected after
 *   it was read is seen by neither the scan nor the materialization, which is
 *   the point: one read, one answer.
 */

import { DomainError } from '../../domain/shared/DomainError'
import type { Experience } from '../../domain/catalog/Experience'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { Block } from '../../domain/resume/Block'
import { isExperienceContent } from '../../domain/resume/Block'
import type { ExperienceId, ResumeId } from '../../domain/shared/branded-id'

export interface ResumeExperiences {
  /**
   * The experience with this id. A lookup never misses: the set was loaded
   * from the blocks that cite the experiences, so every experience a block
   * cites is in it.
   */
  get(experienceId: ExperienceId): Experience
}

export async function loadResumeExperiences(
  experienceRepo: ExperienceRepository,
  resumeId: ResumeId,
  blocks: readonly Block[],
): Promise<ResumeExperiences> {
  const loaded = new Map<ExperienceId, Experience>()
  for (const block of blocks) {
    if (!isExperienceContent(block.content)) continue
    const experienceId = block.content.experienceId
    if (loaded.has(experienceId)) continue
    const experience = await experienceRepo.findById(experienceId)
    if (experience === null) throw experienceMissing(resumeId, experienceId)
    loaded.set(experienceId, experience)
  }
  return {
    get(experienceId: ExperienceId): Experience {
      const experience = loaded.get(experienceId)
      if (experience === undefined) throw experienceMissing(resumeId, experienceId)
      return experience
    },
  }
}

function experienceMissing(resumeId: ResumeId, experienceId: ExperienceId): DomainError {
  return new DomainError(
    'variantNotInExperience',
    'A block references an experience that no longer exists.',
    { entity: 'resume', id: resumeId, blockers: [experienceId] },
  )
}
