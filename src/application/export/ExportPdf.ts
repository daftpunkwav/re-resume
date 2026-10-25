/**
 * @file ExportPdf
 * @description The PDF export use case: it picks the representation the export
 * rules define, gates it on claim status, and hands the laid-out document to
 * the exporter port.
 *
 * Responsibilities:
 * - Export a frozen resume from its newest snapshot and a draft from its
 *   current blocks
 * - Block the export when a block still cites a rejected claim, naming the
 *   blocks so the user can fix them
 * - Report blocks citing pending claims alongside the bytes; the export
 *   proceeds and the caller must surface the notice
 * - Lay the representation out and delegate rendering to the port
 *
 * Constraints:
 * - The claim scan runs before materialization on purpose: materialization
 *   skips every non-confirmed claim silently, so it cannot be the gate.
 * - The use case never touches platform APIs; writing the bytes to a file is
 *   the caller's concern.
 */

import { DomainError } from '../../domain/shared/DomainError'
import type { LayoutOutput } from '../../domain/resume/PageLayout'
import type { PageSetup } from '../../domain/resume/PageSetup'
import type { MaterializedBlock } from '../../domain/resume/ResumeSnapshot'
import type { Resume } from '../../domain/resume/Resume'
import { isExperienceContent } from '../../domain/resume/Block'
import type { ExperienceContent } from '../../domain/resume/Block'
import type { Experience } from '../../domain/catalog/Experience'
import type { ExperienceRepository } from '../../domain/catalog/ports/ExperienceRepository'
import type { ResumeRepository } from '../../domain/resume/ports/ResumeRepository'
import type { ResumePdfExporter } from '../../domain/resume/ports/ResumePdfExporter'
import type { BlockId, ExperienceId, ResumeId } from '../../domain/shared/branded-id'
import { materializeBlocks } from '../resume/materializeBlocks'

export interface ExportedPdf {
  readonly bytes: Uint8Array
  /**
   * Blocks citing pending claims. A draft may carry them (they are marked,
   * not forbidden); the caller must show the notice the export rules require.
   */
  readonly pendingClaimBlocks: readonly BlockId[]
}

export async function exportPdf(
  resumeRepo: ResumeRepository,
  experienceRepo: ExperienceRepository,
  layOut: (blocks: readonly MaterializedBlock[], page: PageSetup) => LayoutOutput,
  exporter: ResumePdfExporter,
  resumeId: ResumeId,
): Promise<ExportedPdf> {
  const resume = await loadResume(resumeRepo, resumeId)
  const representation =
    resume.status === 'frozen' ? snapshotOf(resume) : await draftOf(experienceRepo, resume)
  const laidOut = layOut(representation.blocks, representation.page)
  const bytes = await exporter.render({
    blocks: representation.blocks,
    page: representation.page,
    laidOut,
  })
  return { bytes, pendingClaimBlocks: representation.pendingClaimBlocks }
}

interface ExportRepresentation {
  readonly blocks: readonly MaterializedBlock[]
  readonly page: PageSetup
  readonly pendingClaimBlocks: readonly BlockId[]
}

/**
 * A frozen resume exports from its newest snapshot: the content was
 * materialized at freeze time and cannot shift under a later library edit.
 * The freeze gate already refused pending claims, so no claim notice applies.
 */
function snapshotOf(resume: Resume): ExportRepresentation {
  const newest = resume.snapshots[resume.snapshots.length - 1]
  if (newest === undefined) {
    // Invariant 3 says a frozen resume carries a snapshot; reaching here means
    // the aggregate was hydrated incorrectly, which is a refusal, not a guess.
    throw new DomainError('frozenWithoutSnapshot', 'This frozen resume has no snapshot.', {
      entity: 'resume',
      id: resume.id,
      blockers: [],
    })
  }
  return {
    blocks: newest.materializedBlocks,
    page: newest.pageSetup,
    pendingClaimBlocks: [],
  }
}

/** A draft exports from its live blocks, gated on claim status. */
async function draftOf(
  experienceRepo: ExperienceRepository,
  resume: Resume,
): Promise<ExportRepresentation> {
  const rejectedBlocks = await blocksCitingClaims(experienceRepo, resume, (claim) =>
    claim === undefined || claim.status === 'rejected',
  )
  if (rejectedBlocks.length > 0) {
    throw new DomainError(
      'claimRejected',
      'Remove the rejected statements these blocks cite before exporting.',
      { entity: 'resume', id: resume.id, blockers: rejectedBlocks },
    )
  }
  const pendingClaimBlocks = await blocksCitingClaims(
    experienceRepo,
    resume,
    (claim) => claim !== undefined && claim.status === 'pending',
  )
  return {
    blocks: await materializeBlocks(experienceRepo, resume.id, resume.blocks),
    page: resume.pageSetup,
    pendingClaimBlocks,
  }
}

/**
 * The block ids whose claim citations satisfy the predicate. A claim row that
 * no longer exists counts as rejected: its statement cannot be confirmed any
 * more, the same reading the freeze gate takes.
 */
async function blocksCitingClaims(
  experienceRepo: ExperienceRepository,
  resume: Resume,
  cited: (claim: Experience['claims'][number] | undefined) => boolean,
): Promise<readonly BlockId[]> {
  const loaded = new Map<ExperienceId, Experience>()
  const blockIds: BlockId[] = []
  for (const block of resume.blocks) {
    if (!isExperienceContent(block.content)) continue
    const content: ExperienceContent = block.content
    if (!(await blockCites(experienceRepo, loaded, resume.id, content, cited))) continue
    blockIds.push(block.id)
  }
  return blockIds
}

async function blockCites(
  experienceRepo: ExperienceRepository,
  loaded: Map<ExperienceId, Experience>,
  resumeId: ResumeId,
  content: ExperienceContent,
  cited: (claim: Experience['claims'][number] | undefined) => boolean,
): Promise<boolean> {
  const cached = loaded.get(content.experienceId)
  if (cached !== undefined) return citesClaim(cached, content, cited)
  const experience = await experienceRepo.findById(content.experienceId)
  if (experience === null) {
    throw new DomainError(
      'variantNotInExperience',
      'A block references an experience that no longer exists.',
      { entity: 'resume', id: resumeId, blockers: [content.experienceId] },
    )
  }
  loaded.set(content.experienceId, experience)
  return citesClaim(experience, content, cited)
}

function citesClaim(
  experience: Experience,
  content: ExperienceContent,
  cited: (claim: Experience['claims'][number] | undefined) => boolean,
): boolean {
  return content.claimIds.some((claimId) =>
    cited(experience.claims.find((claim) => claim.id === claimId)),
  )
}

async function loadResume(resumeRepo: ResumeRepository, resumeId: ResumeId): Promise<Resume> {
  const resume = await resumeRepo.findById(resumeId)
  if (resume === null) {
    throw new DomainError('resumeNotFound', 'No resume with this id exists.', {
      entity: 'resume',
      id: resumeId,
      blockers: [],
    })
  }
  return resume
}
