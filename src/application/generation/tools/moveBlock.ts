/**
 * @file moveBlock
 * @description Moves one block to a new position among its siblings. The index
 * addresses the array after the block is taken out, so moving a block onto
 * itself is a no-op rather than an off-by-one.
 *
 * Constraints:
 * - write level. The change is pure: the new array is derived from the state
 *   passed in, never from a closure over the resume that was loaded earlier.
 * - An out-of-range index is clamped rather than refused; reordering is a
 *   gesture, and the agent's arithmetic should not fail the whole call.
 */

import { z } from 'zod'
import { commitDocumentChange } from '../../resume/CommitDocumentChange'
import { describeChange } from '../../../domain/resume/DocumentChange'
import type { Block } from '../../../domain/resume/Block'
import type { AgentRunId, BlockId } from '../../../domain/shared/branded-id'
import { asBlockId, asResumeId } from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

const REVISION_LABEL = '移动块'

export const moveBlockInputSchema = z.object({
  resumeId: z.string().trim().min(1),
  blockId: z.string().trim().min(1),
  index: z.number().int().min(0),
}).strict()

export interface MoveBlockInput {
  readonly resumeId: string
  readonly blockId: string
  readonly index: number
}

export type MoveBlockResult =
  | {
      readonly kind: 'moved'
      readonly resumeId: string
      readonly blockId: string
      readonly index: number
      readonly revisionId: string
    }
  | { readonly kind: 'resumeNotFound'; readonly resumeId: string }
  | { readonly kind: 'blockNotFound'; readonly blockId: string }

export interface MoveBlockDeps {
  /** The run the revision is attributed to; null outside a run. */
  readonly runId: AgentRunId | null
}

export function buildMoveBlockTool(
  deps: MoveBlockDeps,
): RegisteredTool<MoveBlockInput, MoveBlockResult> {
  return {
    name: 'moveBlock',
    description: 'Move a block to another position among the blocks of one resume.',
    risk: 'write',
    parse: (raw: unknown): Result<MoveBlockInput> => {
      const parsed = moveBlockInputSchema.safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (input: MoveBlockInput, ctx: ToolContext): Promise<MoveBlockResult> => {
      const resumeId = asResumeId(input.resumeId)
      const blockId = asBlockId(input.blockId)
      const resume = await ctx.resumes.findById(resumeId)
      if (resume === null) return { kind: 'resumeNotFound', resumeId: input.resumeId }
      if (!resume.blocks.some((block) => block.id === blockId)) {
        return { kind: 'blockNotFound', blockId: input.blockId }
      }

      const revision = await commitDocumentChange(
        ctx.resumes,
        ctx.experiences,
        resumeId,
        describeChange({ label: REVISION_LABEL, origin: 'agent', runId: deps.runId }, (state) => ({
          ...state,
          blocks: reorder(state.blocks, blockId, input.index),
        })),
      )
      return {
        kind: 'moved',
        resumeId: input.resumeId,
        blockId: input.blockId,
        index: input.index,
        revisionId: revision.id,
      }
    },
  }
}

function reorder(blocks: readonly Block[], blockId: BlockId, index: number): readonly Block[] {
  const moved = blocks.find((block) => block.id === blockId)
  if (moved === undefined) return blocks
  const rest = blocks.filter((block) => block.id !== blockId)
  const target = Math.min(Math.max(index, 0), rest.length)
  return [...rest.slice(0, target), moved, ...rest.slice(target)]
}
