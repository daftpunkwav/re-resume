/**
 * @file selectExperienceVariant
 * @description Points an experience block at another wording of the same
 * experience. The variant has to exist, belong to that experience and be
 * confirmed; the refusal lives in commitDocumentChange, which is the single
 * entry point for every document change.
 *
 * Constraints:
 * - write level, so the arguments are identifiers only. Choosing a wording is
 *   selecting existing text; drafting new text is proposeVariant.
 * - refVersion is deliberately left untouched. Re-basing it here would report
 *   stale experience facts as current and hide the block from stale detection.
 */

import { z } from 'zod'
import { commitDocumentChange } from '../../resume/CommitDocumentChange'
import { describeChange } from '../../../domain/resume/DocumentChange'
import { isExperienceContent } from '../../../domain/resume/Block'
import type { Block } from '../../../domain/resume/Block'
import type {
  AgentRunId,
  BlockId,
  VariantId,
} from '../../../domain/shared/branded-id'
import { asBlockId, asResumeId, asVariantId } from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

const REVISION_LABEL = '切换表述'

export const selectExperienceVariantInputSchema = z.object({
  resumeId: z.string().trim().min(1),
  blockId: z.string().trim().min(1),
  variantId: z.string().trim().min(1),
}).strict()

export interface SelectExperienceVariantInput {
  readonly resumeId: string
  readonly blockId: string
  readonly variantId: string
}

export type SelectExperienceVariantResult =
  | {
      readonly kind: 'updated'
      readonly resumeId: string
      readonly blockId: string
      readonly variantId: string
      readonly revisionId: string
    }
  | { readonly kind: 'resumeNotFound'; readonly resumeId: string }
  | { readonly kind: 'blockNotFound'; readonly blockId: string }
  | { readonly kind: 'blockIsNotAnExperience'; readonly blockId: string }

export interface SelectExperienceVariantDeps {
  /** The run the resulting revision is attributed to; null outside a run. */
  readonly runId: AgentRunId | null
}

export function buildSelectExperienceVariantTool(
  deps: SelectExperienceVariantDeps,
): RegisteredTool<SelectExperienceVariantInput, SelectExperienceVariantResult> {
  return {
    name: 'selectExperienceVariant',
    description:
      'Point an existing experience block at another confirmed variant of the same experience.',
    risk: 'write',
    parse: (raw: unknown): Result<SelectExperienceVariantInput> => {
      const parsed = selectExperienceVariantInputSchema.safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (
      input: SelectExperienceVariantInput,
      ctx: ToolContext,
    ): Promise<SelectExperienceVariantResult> => {
      const blockId = asBlockId(input.blockId)
      const resumeId = asResumeId(input.resumeId)
      const resume = await ctx.resumes.findById(resumeId)
      if (resume === null) return { kind: 'resumeNotFound', resumeId: input.resumeId }
      const target = resume.blocks.find((block) => block.id === blockId)
      if (target === undefined) return { kind: 'blockNotFound', blockId: input.blockId }
      if (!isExperienceContent(target.content)) {
        return { kind: 'blockIsNotAnExperience', blockId: input.blockId }
      }

      const variantId = asVariantId(input.variantId)
      const revision = await commitDocumentChange(
        ctx.resumes,
        ctx.experiences,
        resumeId,
        describeChange(
          { label: REVISION_LABEL, origin: 'agent', runId: deps.runId },
          (state) => ({ ...state, blocks: state.blocks.map((block) => switchVariant(block, blockId, variantId)) }),
        ),
      )
      return {
        kind: 'updated',
        resumeId: input.resumeId,
        blockId: input.blockId,
        variantId: input.variantId,
        revisionId: revision.id,
      }
    },
  }
}

function switchVariant(block: Block, blockId: BlockId, variantId: VariantId): Block {
  if (block.id !== blockId || !isExperienceContent(block.content)) return block
  return { ...block, content: { ...block.content, variantId } }
}
