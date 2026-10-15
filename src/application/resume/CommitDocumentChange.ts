/**
 * @file CommitDocumentChange
 * @description The single entry point allowed to change a resume's blocks.
 * Every mutation — user edit, agent draft, undo abandonment — arrives here as
 * a DocumentChange and leaves as one revision.
 *
 * Responsibilities:
 * - Refuse a frozen resume (aggregate invariant 4)
 * - Enforce cross-aggregate invariants 5-7, which the Resume aggregate cannot
 *   see because it holds neither Variant nor Claim rows
 * - Append the revision only after the change and every guard have succeeded
 *
 * Constraints:
 * - Nothing is written when the change throws or a guard refuses. The guards
 *   run on the state the change produced: a change that drops a reference to a
 *   rejected claim has to be able to succeed, or the user could never clear
 *   the reference.
 */

import { DomainError } from '../../domain/shared/DomainError'
import { assertMutable, assertUniqueBlocks } from '../../domain/resume/Resume'
import type { Resume } from '../../domain/resume/Resume'
import type { Revision } from '../../domain/resume/Revision'
import type { Block, ExperienceContent } from '../../domain/resume/Block'
import { isExperienceContent } from '../../domain/resume/Block'
import type { DocumentChange, DocumentState } from '../../domain/resume/DocumentChange'
import type { Experience } from '../../domain/catalog/Experience'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { ExperienceId, ResumeId } from '../../domain/shared/branded-id'

export async function commitDocumentChange(
  resumeRepo: ResumeRepository,
  experienceRepo: ExperienceRepository,
  resumeId: ResumeId,
  change: DocumentChange,
): Promise<Revision> {
  const resume = await loadResume(resumeRepo, resumeId)
  assertMutable(resume)
  const state: DocumentState = change.next({
    blocks: resume.blocks,
    pageSetup: resume.pageSetup,
  })
  assertUniqueBlocks(resumeId, state.blocks)
  await assertReferencesHold(experienceRepo, resumeId, state.blocks)
  return resumeRepo.saveDocument(resumeId, state, change)
}

/**
 * The closed DomainError code set has no "not found" member, so a missing row
 * is reported as the code the resume port's own implementations already use
 * when they cannot resolve the resume's revision chain.
 */
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

async function assertReferencesHold(
  experienceRepo: ExperienceRepository,
  resumeId: ResumeId,
  blocks: readonly Block[],
): Promise<void> {
  const loaded = new Map<ExperienceId, Experience>()
  for (const block of blocks) {
    if (!isExperienceContent(block.content)) continue
    const content = block.content
    const experience = await loadExperience(experienceRepo, loaded, resumeId, content)
    assertVariantBelongsToExperience(experience, content)
    assertVariantIsConfirmed(experience, content)
    assertNoRejectedClaim(experience, content)
  }
}

async function loadExperience(
  experienceRepo: ExperienceRepository,
  loaded: Map<ExperienceId, Experience>,
  resumeId: ResumeId,
  content: ExperienceContent,
): Promise<Experience> {
  const cached = loaded.get(content.experienceId)
  if (cached !== undefined) return cached
  const experience = await experienceRepo.findById(content.experienceId)
  if (experience === null) {
    throw new DomainError(
      'variantNotInExperience',
      'A block references an experience that no longer exists.',
      { entity: 'resume', id: resumeId, blockers: [content.experienceId] },
    )
  }
  loaded.set(content.experienceId, experience)
  return experience
}

/** Invariant 5: the selected variant must belong to the block's experience. */
function assertVariantBelongsToExperience(
  experience: Experience,
  content: ExperienceContent,
): void {
  if (experience.variants.some((variant) => variant.id === content.variantId)) return
  throw new DomainError(
    'variantNotInExperience',
    'The selected variant does not belong to the experience this block references.',
    { entity: 'resume', id: content.experienceId, blockers: [content.variantId] },
  )
}

/** Invariant 6: agent drafts stay unreferenced until the user confirms them. */
function assertVariantIsConfirmed(experience: Experience, content: ExperienceContent): void {
  const variant = experience.variants.find((entry) => entry.id === content.variantId)
  if (variant !== undefined && variant.confirmedAt !== null) return
  throw new DomainError(
    'variantUnconfirmed',
    'The selected variant is an unconfirmed draft. Confirm it before referencing it.',
    { entity: 'resume', id: content.experienceId, blockers: [content.variantId] },
  )
}

/** Invariant 7: a statement the user rejected cannot reach a resume. */
function assertNoRejectedClaim(experience: Experience, content: ExperienceContent): void {
  const rejected: string[] = []
  for (const claimId of content.claimIds) {
    const claim = experience.claims.find((entry) => entry.id === claimId)
    // A claim that is gone can no longer be checked; the port treats an
    // unresolvable claim reference the same way the aggregate does.
    if (claim === undefined || claim.status === 'rejected') rejected.push(claimId)
  }
  if (rejected.length === 0) return
  throw new DomainError(
    'claimRejected',
    'This block references claims the user has rejected. Remove them from the block first.',
    { entity: 'resume', id: content.experienceId, blockers: rejected },
  )
}
