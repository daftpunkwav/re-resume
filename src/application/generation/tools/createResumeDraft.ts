/**
 * @file createResumeDraft
 * @description Builds a new draft from chosen blocks of an existing resume,
 * targeted at a job posting. The selection is identifiers only, so the agent
 * assembles a document out of text the user already wrote.
 *
 * Responsibilities:
 * - Assemble the draft's blocks and refuse the ones the library cannot back
 * - Write the resume and its first revision together, so a refused block leaves
 *   no empty draft behind
 *
 * Constraints:
 * - A profile block is always copied from the current Profile and placed at the
 *   head. The copy is unconditional, takes no part in the blockIds selection,
 *   and does not carry the source's older copy over; a draft that inherited a
 *   stale name is how contact details silently go out of date.
 * - Every copied block gets a fresh id and a reference version rebased on the
 *   current library, so the draft shares no identity with its source.
 * - The references are checked before the insert rather than through
 *   commitDocumentChange: that use case appends a second revision to a resume
 *   that already exists, which is the shape this tool must not have.
 */

import { z } from 'zod'
import { createResumeFromDocument } from '../../resume/CreateResume'
import type { ResumeCreation } from '../../resume/CreateResume'
import { assertBlocksMayBeReferenced } from '../../resume/assertBlockReferences'
import { A4_PAGE_SETUP } from '../../../domain/resume/PageSetup'
import { DEFAULT_FLOW_LAYOUT } from '../../../domain/resume/Layout'
import { isExperienceContent, isProfileContent } from '../../../domain/resume/Block'
import type { Block } from '../../../domain/resume/Block'
import { toProfileFields } from '../../../domain/catalog/Profile'
import type { Experience } from '../../../domain/catalog/Experience'
import { DomainError } from '../../../domain/shared/DomainError'
import type { IdGenerator } from '../../../domain/shared/IdGenerator'
import type {
  AgentRunId,
  ExperienceId,
} from '../../../domain/shared/branded-id'
import {
  asBlockId,
  asJobPostingId,
  asResumeId,
} from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import type { JobPostingRepository } from '../ParseJobPosting'

const REVISION_LABEL = '创建简历草稿'

export const createResumeDraftInputSchema = z.object({
  jobPostingId: z.string().trim().min(1),
  sourceResumeId: z.string().trim().min(1),
  blockIds: z.array(z.string().trim().min(1)),
}).strict()

export interface CreateResumeDraftInput {
  readonly jobPostingId: string
  readonly sourceResumeId: string
  readonly blockIds: readonly string[]
}

export type CreateResumeDraftResult =
  | {
      readonly kind: 'created'
      readonly resumeId: string
      readonly sourceResumeId: string
      readonly jobPostingId: string
      /** Head first: the copied profile block, then the selected blocks. */
      readonly blockIds: readonly string[]
    }
  | { readonly kind: 'sourceNotFound'; readonly sourceResumeId: string }
  | { readonly kind: 'postingNotFound'; readonly jobPostingId: string }
  | {
      readonly kind: 'unknownBlock'
      readonly unknownBlockIds: readonly string[]
    }

export interface CreateResumeDraftDeps {
  readonly jobPostings: JobPostingRepository
  readonly ids: IdGenerator
  readonly resumeCreation: ResumeCreation
  /** The run the draft's revision is attributed to; null outside a run. */
  readonly runId: AgentRunId | null
}

export function buildCreateResumeDraftTool(
  deps: CreateResumeDraftDeps,
): RegisteredTool<CreateResumeDraftInput, CreateResumeDraftResult> {
  return {
    name: 'createResumeDraft',
    description:
      'Create a new draft resume from selected blocks of an existing resume, with the current profile copied to the head.',
    risk: 'write',
    parse: (raw: unknown): Result<CreateResumeDraftInput> => {
      const parsed = createResumeDraftInputSchema.safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (
      input: CreateResumeDraftInput,
      ctx: ToolContext,
    ): Promise<CreateResumeDraftResult> => {
      const posting = await deps.jobPostings.findById(asJobPostingId(input.jobPostingId))
      if (posting === null) return { kind: 'postingNotFound', jobPostingId: input.jobPostingId }
      const source = await ctx.resumes.findById(asResumeId(input.sourceResumeId))
      if (source === null) return { kind: 'sourceNotFound', sourceResumeId: input.sourceResumeId }

      const selected = selectBlocks(source.blocks, input.blockIds)
      if (!('blocks' in selected)) return selected

      const profileBlock = await profileBlockFrom(ctx, deps.ids)
      const copied = await copyBlocks(source.id, selected.blocks, ctx, deps.ids)
      const blocks: readonly Block[] = [profileBlock, ...copied]
      await assertBlocksMayBeReferenced(ctx.experiences, blocks)
      const title = posting.parsed?.title ?? source.title
      const newResumeId = await createResumeFromDocument(deps.resumeCreation, deps.ids, ctx.clock, {
        title,
        targetRole: posting.parsed?.title ?? null,
        document: { blocks, pageSetup: A4_PAGE_SETUP },
        provenance: { label: REVISION_LABEL, origin: 'agent', runId: deps.runId },
      })
      return {
        kind: 'created',
        resumeId: newResumeId,
        sourceResumeId: source.id,
        jobPostingId: posting.id,
        blockIds: blocks.map((block) => block.id),
      }
    },
  }
}

/**
 * Selected blocks keep their source order: the argument names which blocks to
 * carry over, and reordering the copy is what reorderResumeSections is for.
 * A profile block named in blockIds is dropped rather than refused, because
 * the fresh copy below always occupies the one slot a resume has for it.
 */
function selectBlocks(
  blocks: readonly Block[],
  blockIds: readonly string[],
): { readonly blocks: readonly Block[] } | CreateResumeDraftResult {
  const wanted = new Set(blockIds)
  const known = new Set(blocks.map((block) => block.id))
  const unknownBlockIds = blockIds.filter((id) => !known.has(asBlockId(id)))
  if (unknownBlockIds.length > 0) return { kind: 'unknownBlock', unknownBlockIds }
  if (wanted.size === 0) return { blocks: [] }
  return {
    blocks: blocks.filter(
      (block) => wanted.has(block.id) && !isProfileContent(block.content),
    ),
  }
}

async function copyBlocks(
  sourceResumeId: string,
  blocks: readonly Block[],
  ctx: ToolContext,
  ids: IdGenerator,
): Promise<readonly Block[]> {
  const loaded = new Map<ExperienceId, Experience>()
  const copies: Block[] = []
  for (const block of blocks) {
    copies.push({
      id: asBlockId(ids.next()),
      content: isExperienceContent(block.content)
        ? {
            ...block.content,
            refVersion: (
              await loadExperience(ctx, loaded, sourceResumeId, block.content.experienceId)
            ).factVersion,
          }
        : block.content,
      layout: block.layout,
      textStyle: block.textStyle,
    })
  }
  return copies
}

async function loadExperience(
  ctx: ToolContext,
  loaded: Map<ExperienceId, Experience>,
  resumeId: string,
  experienceId: ExperienceId,
): Promise<Experience> {
  const cached = loaded.get(experienceId)
  if (cached !== undefined) return cached
  const experience = await ctx.experiences.findById(experienceId)
  if (experience === null) {
    throw new DomainError(
      'variantNotInExperience',
      'The source resume references an experience that no longer exists.',
      { entity: 'resume', id: resumeId, blockers: [experienceId] },
    )
  }
  loaded.set(experienceId, experience)
  return experience
}

async function profileBlockFrom(ctx: ToolContext, ids: IdGenerator): Promise<Block> {
  const profile = await ctx.profiles.get()
  return {
    id: asBlockId(ids.next()),
    content: { type: 'profile', ...toProfileFields(profile), refVersion: profile.version },
    layout: DEFAULT_FLOW_LAYOUT,
    textStyle: null,
  }
}
