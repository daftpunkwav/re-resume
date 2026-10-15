/**
 * @file addBlock
 * @description Appends an experience block to a resume. Its arguments are the
 * identifiers of existing rows: an existing experience, an existing variant
 * and the claims the block relies on. Nothing the agent writes as text enters
 * a resume here.
 *
 * Constraints:
 * - write level, and the argument set is what makes the truthfulness chain
 *   reachable: claimIds are how a block says which assertions it rests on.
 * - Whether those claims exist, are not rejected, and whether the variant
 *   belongs to the experience and is confirmed, is decided by
 *   commitDocumentChange. This tool does not restate those rules.
 */

import { z } from 'zod'
import { commitDocumentChange } from '../../resume/CommitDocumentChange'
import { describeChange } from '../../../domain/resume/DocumentChange'
import { DEFAULT_FLOW_LAYOUT } from '../../../domain/resume/Layout'
import type { Block } from '../../../domain/resume/Block'
import type { IdGenerator } from '../../../domain/shared/IdGenerator'
import type { AgentRunId } from '../../../domain/shared/branded-id'
import {
  asBlockId,
  asClaimId,
  asExperienceId,
  asResumeId,
  asVariantId,
} from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

const REVISION_LABEL = '添加经历块'

export const addBlockInputSchema = z.object({
  resumeId: z.string().trim().min(1),
  experienceId: z.string().trim().min(1),
  variantId: z.string().trim().min(1),
  claimIds: z.array(z.string().trim().min(1)),
}).strict()

export interface AddBlockInput {
  readonly resumeId: string
  readonly experienceId: string
  readonly variantId: string
  readonly claimIds: readonly string[]
}

export type AddBlockResult =
  | {
      readonly kind: 'added'
      readonly resumeId: string
      readonly blockId: string
      readonly revisionId: string
    }
  | { readonly kind: 'resumeNotFound'; readonly resumeId: string }
  | { readonly kind: 'experienceNotFound'; readonly experienceId: string }

export interface AddBlockDeps {
  readonly ids: IdGenerator
  /** The run the appended revision is attributed to; null outside a run. */
  readonly runId: AgentRunId | null
}

export function buildAddBlockTool(
  deps: AddBlockDeps,
): RegisteredTool<AddBlockInput, AddBlockResult> {
  return {
    name: 'addBlock',
    description:
      'Append an experience block that references an existing variant and the claims it relies on.',
    risk: 'write',
    parse: (raw: unknown): Result<AddBlockInput> => {
      const parsed = addBlockInputSchema.safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (input: AddBlockInput, ctx: ToolContext): Promise<AddBlockResult> => {
      const resumeId = asResumeId(input.resumeId)
      const resume = await ctx.resumes.findById(resumeId)
      if (resume === null) return { kind: 'resumeNotFound', resumeId: input.resumeId }

      const experienceId = asExperienceId(input.experienceId)
      const experience = await ctx.experiences.findById(experienceId)
      if (experience === null) {
        return { kind: 'experienceNotFound', experienceId: input.experienceId }
      }

      const variantId = asVariantId(input.variantId)
      const blockId = asBlockId(deps.ids.next())
      const block: Block = {
        id: blockId,
        content: {
          type: 'experience',
          experienceId,
          variantId,
          refVersion: experience.factVersion,
          claimIds: input.claimIds.map((claimId) => asClaimId(claimId)),
        },
        layout: DEFAULT_FLOW_LAYOUT,
        textStyle: null,
      }
      const revision = await commitDocumentChange(
        ctx.resumes,
        ctx.experiences,
        resumeId,
        describeChange({ label: REVISION_LABEL, origin: 'agent', runId: deps.runId }, (state) => ({
          ...state,
          blocks: [...state.blocks, block],
        })),
      )
      return { kind: 'added', resumeId: input.resumeId, blockId, revisionId: revision.id }
    },
  }
}
