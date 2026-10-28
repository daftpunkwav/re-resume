/**
 * @file draftTools
 * @description The two draft tools: the tailored summary and a rewritten entry
 * body. Draft text is the only free prose the agent may write into a resume, so
 * both tools are marked `draft` and both commit one revision the card can undo.
 *
 * Constraints:
 * - The text bounds are the domain limits (summary 4000, entry 2000 code points);
 *   the use cases enforce them and the tools do not restate the bound in logic.
 * - The override keeps its identifier when rewritten, so the history stays a
 *   continuous chain rather than a new override each turn.
 */

import { z } from 'zod'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import {
  asInfoEntryId,
  asResumeId,
} from '../../../domain/shared/branded-id'
import { writeEntryOverride } from '../../resume/writeEntryOverride'
import { writeSummaryOverride } from '../../resume/writeSummaryOverride'
import type { ToolPackDeps } from './deps'
import { defineTool, executeSafely, resumeProvenance } from './toolSchema'
import type { ToolDefinition } from './toolSchema'

export function createDraftTools(deps: ToolPackDeps): readonly ToolDefinition<unknown>[] {
  return [
    defineTool({
      name: 'writeResumeSummary',
      description: '为简历撰写面向目标岗位的总结文案。只改写简历里的展示文案，不改动信息库事实。',
      risk: 'draft',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        text: z.string().trim().min(1).max(4000),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          const result = await writeSummaryOverride(
            { resumes: deps.resumes, ids: deps.ids, clock: deps.clock },
            { resumeId, text: input.text, ...resumeProvenance(context) },
          )
          return {
            resumeId,
            overrideId: result.override.id,
            revisionId: result.revision.id,
          }
        }),
    }),
    defineTool({
      name: 'writeEntryOverride',
      description: '为简历中的某一条目改写展示文案，信息库中的原始事实保持不变。',
      risk: 'draft',
      schema: z.strictObject({
        resumeId: z.string().trim().min(1),
        entryId: z.string().trim().min(1),
        text: z.string().trim().min(1).max(2000),
      }),
      execute: (input, context: ToolContext) =>
        executeSafely(async () => {
          const resumeId = asResumeId(input.resumeId)
          const result = await writeEntryOverride(
            { resumes: deps.resumes, ids: deps.ids, clock: deps.clock },
            {
              resumeId,
              entryId: asInfoEntryId(input.entryId),
              text: input.text,
              ...resumeProvenance(context),
            },
          )
          return {
            resumeId,
            overrideId: result.override.id,
            revisionId: result.revision.id,
          }
        }),
    }),
  ]
}
