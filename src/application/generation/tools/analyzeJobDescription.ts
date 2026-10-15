/**
 * @file analyzeJobDescription
 * @description Reads what ParseJobPosting already extracted from a job
 * description. It never calls a model: the tool holds no ModelProvider, so the
 * "analysis runs before the agent" rule is a property of this file's
 * dependencies rather than an instruction.
 *
 * Constraints:
 * - An unparsed posting returns an explicit notParsed outcome. Returning the
 *   parse fields as null instead would leave the model to guess whether the
 *   row is empty or the read failed.
 * - read level. Nothing here writes.
 */

import { z } from 'zod'
import type { JobPostingRepository } from '../ParseJobPosting'
import type { ParsedJobPosting } from '../../../domain/generation/JobPosting'
import { asJobPostingId } from '../../../domain/shared/branded-id'
import type { DateTime } from '../../../domain/shared/DateTime'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

export const analyzeJobDescriptionInputSchema = z.object({
  jobPostingId: z.string().trim().min(1),
}).strict()

export interface AnalyzeJobDescriptionInput {
  readonly jobPostingId: string
}

export type JobPostingAnalysis =
  | {
      readonly kind: 'parsed'
      readonly jobPostingId: string
      readonly parsed: ParsedJobPosting
      readonly parsedByRunId: string | null
      readonly parsedAt: DateTime | null
    }
  | {
      readonly kind: 'notParsed'
      readonly jobPostingId: string
      readonly reason: string
    }
  | { readonly kind: 'notFound'; readonly jobPostingId: string }

export function buildAnalyzeJobDescriptionTool(
  jobPostings: JobPostingRepository,
): RegisteredTool<AnalyzeJobDescriptionInput, JobPostingAnalysis> {
  return {
    name: 'analyzeJobDescription',
    description:
      'Read the requirements already extracted from a job description. An unparsed posting reports notParsed.',
    risk: 'read',
    parse: (raw: unknown): Result<AnalyzeJobDescriptionInput> => {
      const parsed = analyzeJobDescriptionInputSchema.safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (
      input: AnalyzeJobDescriptionInput,
      _ctx: ToolContext,
    ): Promise<JobPostingAnalysis> => {
      const posting = await jobPostings.findById(asJobPostingId(input.jobPostingId))
      if (posting === null) return { kind: 'notFound', jobPostingId: input.jobPostingId }
      if (posting.parsed === null) {
        return {
          kind: 'notParsed',
          jobPostingId: posting.id,
          reason: 'This posting has not been parsed yet. ParseJobPosting has to run before it can be analyzed.',
        }
      }
      return {
        kind: 'parsed',
        jobPostingId: posting.id,
        parsed: posting.parsed,
        parsedByRunId: posting.parsedByRunId,
        parsedAt: posting.parsedAt,
      }
    },
  }
}
