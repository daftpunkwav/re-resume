/**
 * @file checkResumeLayout
 * @description Paginates a draft's current document and reports what does not
 * fit. It runs the same layout function the canvas and both exporters read, so
 * the agent sees the pages the user will see rather than an estimate.
 *
 * Constraints:
 * - A live experience block carries no text, so the blocks are materialized
 *   first; layout() receives MaterializedBlock, not Block.
 * - LayoutInput carries its measurer while the ToolContext comment describes
 *   the measurer as bound to layout(). The canonical instance is therefore
 *   injected here at composition time and handed to layout() as the input asks.
 */

import { z } from 'zod'
import { materializeBlocks } from '../../resume/materializeBlocks'
import type { OverflowReport } from '../../../domain/resume/PageLayout'
import type { TextMeasurer } from '../../../domain/resume/ports/TextMeasurer'
import { asResumeId } from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

export const checkResumeLayoutInputSchema = z.object({
  resumeId: z.string().trim().min(1),
}).strict()

export interface CheckResumeLayoutInput {
  readonly resumeId: string
}

export type ResumeLayoutReport =
  | {
      readonly kind: 'checked'
      readonly resumeId: string
      readonly pageCount: number
      readonly blockCount: number
      readonly overflows: readonly OverflowReport[]
    }
  | { readonly kind: 'notFound'; readonly resumeId: string }

export function buildCheckResumeLayoutTool(
  measurer: TextMeasurer,
): RegisteredTool<CheckResumeLayoutInput, ResumeLayoutReport> {
  return {
    name: 'checkResumeLayout',
    description:
      'Lay out a resume and report its page count and the blocks that overflow their page.',
    risk: 'read',
    parse: (raw: unknown): Result<CheckResumeLayoutInput> => {
      const parsed = checkResumeLayoutInputSchema.safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (
      input: CheckResumeLayoutInput,
      ctx: ToolContext,
    ): Promise<ResumeLayoutReport> => {
      const resume = await ctx.resumes.findById(asResumeId(input.resumeId))
      if (resume === null) return { kind: 'notFound', resumeId: input.resumeId }
      const blocks = await materializeBlocks(ctx.experiences, resume.id, resume.blocks)
      const laidOut = ctx.layout({ blocks, page: resume.pageSetup, measurer })
      return {
        kind: 'checked',
        resumeId: resume.id,
        pageCount: laidOut.pages.length,
        blockCount: blocks.length,
        overflows: laidOut.overflows,
      }
    },
  }
}
