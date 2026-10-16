/**
 * @file reorderResumeSections
 * @description Reorders every block of a resume in one step, which is how a
 * draft's section order is set. It differs from moveBlock in that it is
 * refused unless the argument is a complete permutation of the current blocks:
 * a partial order would silently drop the blocks it does not mention.
 *
 * Constraints:
 * - write level. The permutation check runs before the change is built, so a
 *   refused order leaves no revision behind.
 */

import { z } from 'zod'
import { commitDocumentChange } from '../../resume/CommitDocumentChange'
import { describeChange } from '../../../domain/resume/DocumentChange'
import { DomainError } from '../../../domain/shared/DomainError'
import type { Block } from '../../../domain/resume/Block'
import type { AgentRunId, BlockId, ResumeId } from '../../../domain/shared/branded-id'
import { asBlockId, asResumeId } from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

const REVISION_LABEL = '调整章节顺序'

export const reorderResumeSectionsInputSchema = z.object({
  resumeId: z.string().trim().min(1),
  order: z.array(z.string().trim().min(1)),
}).strict()

export interface ReorderResumeSectionsInput {
  readonly resumeId: string
  /** Every block id of the resume, in the wanted order. */
  readonly order: readonly string[]
}

export type ReorderResumeSectionsResult =
  | {
      readonly kind: 'reordered'
      readonly resumeId: string
      readonly order: readonly string[]
      readonly revisionId: string
    }
  | { readonly kind: 'resumeNotFound'; readonly resumeId: string }
  | {
      readonly kind: 'notAPermutation'
      readonly missingBlockIds: readonly string[]
      readonly unknownBlockIds: readonly string[]
    }

export interface ReorderResumeSectionsDeps {
  /** The run the revision is attributed to; null outside a run. */
  readonly runId: AgentRunId | null
}

export function buildReorderResumeSectionsTool(
  deps: ReorderResumeSectionsDeps,
): RegisteredTool<ReorderResumeSectionsInput, ReorderResumeSectionsResult> {
  return {
    name: 'reorderResumeSections',
    description:
      'Set the order of every block in a resume. The order must list each block exactly once.',
    risk: 'write',
    parse: (raw: unknown): Result<ReorderResumeSectionsInput> => {
      const parsed = reorderResumeSectionsInputSchema.safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (
      input: ReorderResumeSectionsInput,
      ctx: ToolContext,
    ): Promise<ReorderResumeSectionsResult> => {
      const resumeId = asResumeId(input.resumeId)
      const resume = await ctx.resumes.findById(resumeId)
      if (resume === null) return { kind: 'resumeNotFound', resumeId: input.resumeId }

      const requested = input.order.map((blockId) => asBlockId(blockId))
      const current = new Set(resume.blocks.map((block) => block.id))
      const named = new Set(requested)
      const missingBlockIds = resume.blocks
        .filter((block) => !named.has(block.id))
        .map((block) => block.id)
      const unknownBlockIds = requested.filter((blockId) => !current.has(blockId))
      // A Set collapses duplicates, so an order that names a block twice would
      // otherwise pass the length checks and produce a document holding a copy
      // of it. A permutation names every block exactly once.
      const duplicated = requested.length !== named.size
      if (duplicated || missingBlockIds.length > 0 || unknownBlockIds.length > 0) {
        return { kind: 'notAPermutation', missingBlockIds, unknownBlockIds }
      }

      const revision = await commitDocumentChange(
        ctx.resumes,
        ctx.experiences,
        resumeId,
        describeChange({ label: REVISION_LABEL, origin: 'agent', runId: deps.runId }, (state) => ({
          ...state,
          blocks: applyOrder(resume.id, state.blocks, requested),
        })),
      )
      return {
        kind: 'reordered',
        resumeId: input.resumeId,
        order: input.order,
        revisionId: revision.id,
      }
    },
  }
}

/**
 * Blocks are taken from the state the change receives, not from the resume read
 * before it. The validated order is a list of ids, so a document that changed
 * underneath is refused here instead of having a block written that no longer
 * belongs to it.
 */
function applyOrder(
  resumeId: ResumeId,
  blocks: readonly Block[],
  order: readonly BlockId[],
): readonly Block[] {
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const ordered: Block[] = []
  for (const blockId of order) {
    const block = byId.get(blockId)
    if (block === undefined) {
      throw new DomainError('duplicateBlockId', 'The block order no longer matches the document.', {
        entity: 'resume',
        id: resumeId,
        blockers: [blockId],
      })
    }
    ordered.push(block)
  }
  return ordered
}
