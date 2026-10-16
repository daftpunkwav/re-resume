/**
 * @file assertBlockReferences
 * @description Cross-aggregate invariants 5-7: a block may only select a
 * confirmed variant of the experience it names, and may not carry a claim the
 * user rejected. The Resume aggregate holds neither Variant nor Claim rows, so
 * the check lives in the application layer and is asked before anything is
 * written.
 *
 * Responsibilities:
 * - Load each referenced experience once per document
 * - Refuse an unknown experience, a variant from another experience, an
 *   unconfirmed variant and a rejected claim
 *
 * Constraints:
 * - Every refusal names the experience rather than the document. A document
 *   can be a resume being edited or a draft that does not exist yet, and the
 *   experience is the thing that has to change before either becomes writable.
 */

import { DomainError } from '../../domain/shared/DomainError'
import type { Block, ExperienceContent } from '../../domain/resume/Block'
import { isExperienceContent } from '../../domain/resume/Block'
import type { Experience } from '../../domain/catalog/Experience'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ExperienceId } from '../../domain/shared/branded-id'

export async function assertBlocksMayBeReferenced(
  experienceRepo: ExperienceRepository,
  blocks: readonly Block[],
): Promise<void> {
  const loaded = new Map<ExperienceId, Experience>()
  for (const block of blocks) {
    if (!isExperienceContent(block.content)) continue
    const content = block.content
    const experience = await loadExperience(experienceRepo, loaded, content)
    assertVariantBelongsToExperience(experience, content)
    assertVariantIsConfirmed(experience, content)
    assertNoRejectedClaim(experience, content)
  }
}

async function loadExperience(
  experienceRepo: ExperienceRepository,
  loaded: Map<ExperienceId, Experience>,
  content: ExperienceContent,
): Promise<Experience> {
  const cached = loaded.get(content.experienceId)
  if (cached !== undefined) return cached
  const experience = await experienceRepo.findById(content.experienceId)
  if (experience === null) {
    throw new DomainError('variantNotInExperience', 'A block references an experience that no longer exists.', {
      entity: 'experience',
      id: content.experienceId,
      blockers: [content.experienceId],
    })
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
    { entity: 'experience', id: content.experienceId, blockers: [content.variantId] },
  )
}

/** Invariant 6: agent drafts stay unreferenced until the user confirms them. */
function assertVariantIsConfirmed(experience: Experience, content: ExperienceContent): void {
  const variant = experience.variants.find((entry) => entry.id === content.variantId)
  if (variant !== undefined && variant.confirmedAt !== null) return
  throw new DomainError(
    'variantUnconfirmed',
    'The selected variant is an unconfirmed draft. Confirm it before referencing it.',
    { entity: 'experience', id: content.experienceId, blockers: [content.variantId] },
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
    { entity: 'experience', id: content.experienceId, blockers: rejected },
  )
}
