/**
 * @file DuplicateResume
 * @description Copies a resume's current document into a brand new draft.
 * This is the only iteration path a frozen resume has: there is no in-place
 * unfreeze.
 *
 * Responsibilities:
 * - Regenerate every block id so the copy shares nothing with its source
 * - Rebase each reference's version on the current library version
 * - Start the copy with its own initial revision: no history, no snapshots
 *
 * Constraints:
 * - A frozen source is duplicable on purpose; freezing is not a barrier here.
 * - The copy is written here rather than returned as a draft state, because a
 *   resume that exists only in a caller's memory is not yet usable and the
 *   creation of the resume and its first revision is one atomic step.
 */

import { DomainError } from '../../domain/shared/DomainError'
import { INITIAL_REVISION_LABEL } from '../../domain/resume/Revision'
import type { Resume } from '../../domain/resume/Resume'
import type { DocumentState } from '../../domain/resume/DocumentChange'
import { isExperienceContent, isProfileContent } from '../../domain/resume/Block'
import type { Block } from '../../domain/resume/Block'
import type { Experience } from '../../domain/catalog/Experience'
import type { Profile } from '../../domain/catalog/Profile'
import type { Clock } from '../../domain/catalog/ports/Clock'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ProfileRepository } from '../../domain/catalog/ports/ProfileRepository'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { ExperienceId, ResumeId } from '../../domain/shared/branded-id'
import { asBlockId } from '../../domain/shared/branded-id'
import { assertBlocksMayBeReferenced } from './assertBlockReferences'
import { createResumeFromDocument } from './CreateResume'
import type { ResumeCreation } from './CreateResume'

export interface DuplicateResumeInput {
  readonly sourceResumeId: ResumeId
  /** Defaults to the source title marked as a copy. */
  readonly title?: string
}

export async function duplicateResume(
  resumeRepo: ResumeRepository,
  resumeCreation: ResumeCreation,
  experienceRepo: ExperienceRepository,
  profileRepo: ProfileRepository,
  ids: IdGenerator,
  clock: Clock,
  input: DuplicateResumeInput,
): Promise<ResumeId> {
  const source = await loadResume(resumeRepo, input.sourceResumeId)
  const profile = await profileRepo.get()
  const document: DocumentState = {
    blocks: await copyBlocks(source.id, source.blocks, experienceRepo, profile, ids),
    pageSetup: source.pageSetup,
  }
  // A copy of a resume written before a claim was rejected would otherwise carry
  // that claim into a document no editor ever chose it for. Checked before the
  // insert so a refusal leaves no duplicate behind.
  await assertBlocksMayBeReferenced(experienceRepo, document.blocks)
  return createResumeFromDocument(resumeCreation, ids, clock, {
    title: input.title ?? `${source.title}（副本）`,
    targetRole: source.targetRole,
    document,
    provenance: { label: INITIAL_REVISION_LABEL, origin: 'user', runId: null },
  })
}

/**
 * Block content is copied verbatim except for the reference versions, which are
 * rebased on the current library versions. The profile block's inlined values
 * travel unchanged, so the copy carries the source document's contact details
 * while reporting the current profile version. That keeps the result a
 * faithful duplicate; a profile edit reaches a block only through the sync the
 * user confirms.
 */
async function copyBlocks(
  sourceResumeId: ResumeId,
  blocks: readonly Block[],
  experienceRepo: ExperienceRepository,
  profile: Profile,
  ids: IdGenerator,
): Promise<readonly Block[]> {
  const loaded = new Map<ExperienceId, Experience>()
  const copies: Block[] = []
  for (const block of blocks) {
    const id = asBlockId(ids.next())
    const content = isExperienceContent(block.content)
      ? {
          ...block.content,
          refVersion: (
            await loadExperience(experienceRepo, loaded, sourceResumeId, block.content.experienceId)
          ).factVersion,
        }
      : isProfileContent(block.content)
        ? { ...block.content, refVersion: profile.version }
        : block.content
    copies.push({ id, content, layout: block.layout, textStyle: block.textStyle })
  }
  return copies
}

async function loadExperience(
  experienceRepo: ExperienceRepository,
  loaded: Map<ExperienceId, Experience>,
  sourceResumeId: ResumeId,
  experienceId: ExperienceId,
): Promise<Experience> {
  const cached = loaded.get(experienceId)
  if (cached !== undefined) return cached
  const experience = await experienceRepo.findById(experienceId)
  if (experience === null) {
    throw new DomainError(
      'variantNotInExperience',
      'The source resume references an experience that no longer exists.',
      { entity: 'resume', id: sourceResumeId, blockers: [experienceId] },
    )
  }
  loaded.set(experienceId, experience)
  return experience
}

async function loadResume(resumeRepo: ResumeRepository, resumeId: ResumeId): Promise<Resume> {
  const resume = await resumeRepo.findById(resumeId)
  if (resume === null) {
    throw new DomainError('cursorNotOnLiveChain', 'No resume with this id exists.', {
      entity: 'resume',
      id: resumeId,
      blockers: [],
    })
  }
  return resume
}
