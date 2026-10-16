/**
 * @file materializeBlocks
 * @description Resolves every block reference to inline text once, at freeze
 * time. This is the only place a snapshot's content is produced, so the rules
 * live here rather than in the freezing use case.
 *
 * Responsibilities:
 * - Expand an experience block into its fact fields plus the selected variant content
 * - Inline confirmed claims as text that carries its own ClaimId
 * - Copy block identity, layout and text style so a snapshot renders standalone
 *
 * Constraints:
 * - A missing experience, variant or claim raises DomainError. An empty block
 *   would freeze a hole into the resume instead of a refusal.
 * - graphic keeps its assetId: image bytes are the one live reference a
 *   snapshot retains.
 */

import { DomainError } from '../../domain/shared/DomainError'
import type { ResumeId } from '../../domain/shared/branded-id'
import type { Experience } from '../../domain/catalog/Experience'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import { isExperienceContent } from '../../domain/resume/Block'
import type { Block, BlockContent, ExperienceContent } from '../../domain/resume/Block'
import type {
  MaterializedBlock,
  MaterializedClaim,
  MaterializedContent,
} from '../../domain/resume/ResumeSnapshot'

export async function materializeBlocks(
  experienceRepo: ExperienceRepository,
  resumeId: ResumeId,
  blocks: readonly Block[],
): Promise<readonly MaterializedBlock[]> {
  const loaded = new Map<string, Experience>()
  const materialized: MaterializedBlock[] = []
  for (const block of blocks) {
    if (!isExperienceContent(block.content)) {
      materialized.push({
        id: block.id,
        content: inlineContent(block.content),
        layout: block.layout,
        textStyle: block.textStyle,
        claims: [],
      })
      continue
    }
    const experience = await loadExperience(experienceRepo, loaded, resumeId, block.content)
    materialized.push({
      id: block.id,
      content: expandExperience(experience, block.content),
      layout: block.layout,
      textStyle: block.textStyle,
      claims: inlineClaims(experience, block.content),
    })
  }
  return materialized
}

function inlineContent(content: Exclude<BlockContent, ExperienceContent>): MaterializedContent {
  if (content.type === 'profile') {
    // refVersion describes the copy and has no meaning once the values are
    // inlined, so the snapshot drops it.
    const { displayName, email, phone, links } = content
    return { type: 'profile', displayName, email, phone, links }
  }
  return content
}

function expandExperience(experience: Experience, content: ExperienceContent): MaterializedContent {
  const variant = experience.variants.find((entry) => entry.id === content.variantId)
  if (variant === undefined) {
    throw new DomainError(
      'variantNotInExperience',
      'The variant this block selects no longer exists on its experience.',
      { entity: 'resume', id: content.experienceId, blockers: [content.variantId] },
    )
  }
  if (variant.confirmedAt === null) {
    throw new DomainError(
      'variantUnconfirmed',
      'The variant this block selects has not been confirmed.',
      { entity: 'resume', id: content.experienceId, blockers: [content.variantId] },
    )
  }
  return {
    type: 'experience',
    title: experience.title,
    organization: experience.organization,
    startDate: experience.startDate,
    endDate: experience.endDate,
    variantContent: variant.content,
  }
}

function inlineClaims(
  experience: Experience,
  content: ExperienceContent,
): readonly MaterializedClaim[] {
  const claims: MaterializedClaim[] = []
  for (const claimId of content.claimIds) {
    const claim = experience.claims.find((entry) => entry.id === claimId)
    if (claim === undefined) {
      throw new DomainError(
        'claimRejected',
        'A claim referenced by this block no longer exists.',
        { entity: 'resume', id: content.experienceId, blockers: [claimId] },
      )
    }
    // Only confirmed statements reach a snapshot; a pending one is refused by
    // FreezeResume before materialization starts.
    if (claim.status !== 'confirmed') continue
    claims.push({
      claimId: claim.id,
      kind: claim.kind,
      statement: claim.statement,
      sourceField: claim.sourceField,
    })
  }
  return claims
}

async function loadExperience(
  experienceRepo: ExperienceRepository,
  loaded: Map<string, Experience>,
  resumeId: ResumeId,
  content: ExperienceContent,
): Promise<Experience> {
  const cached = loaded.get(content.experienceId)
  if (cached !== undefined) return cached
  const experience = await experienceRepo.findById(content.experienceId)
  if (experience === null) {
    throw new DomainError(
      'variantNotInExperience',
      'This block references an experience that no longer exists.',
      { entity: 'resume', id: resumeId, blockers: [content.experienceId] },
    )
  }
  loaded.set(content.experienceId, experience)
  return experience
}
