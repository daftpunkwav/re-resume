/**
 * @file matchExperiences
 * @description Ranks the catalog against a parsed job description. It reads
 * the requirements ParseJobPosting produced; it does not call a model and does
 * not read the raw description, because the raw text is unparsed input and a
 * match built on it would bypass the provenance the parse records.
 *
 * Constraints:
 * - read level. Ranking is arithmetic over rows the catalog already holds, so
 *   the result is reproducible for a given posting and catalog.
 */

import { z } from 'zod'
import type { JobPostingRepository } from '../ParseJobPosting'
import type { Experience } from '../../../domain/catalog/Experience'
import type { ExperienceKind } from '../../../domain/catalog/ExperienceKind'
import type { ExperienceId } from '../../../domain/shared/branded-id'
import { asJobPostingId } from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { Result } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

const DEFAULT_MATCH_LIMIT = 5
const MAX_MATCH_LIMIT = 20

const TITLE_WEIGHT = 3
const ORGANIZATION_WEIGHT = 2
const BODY_WEIGHT = 1

export const matchExperiencesInputSchema = z.object({
  jobPostingId: z.string().trim().min(1),
  limit: z.number().int().positive().max(MAX_MATCH_LIMIT).optional(),
}).strict()

export interface MatchExperiencesInput {
  readonly jobPostingId: string
  readonly limit?: number
}

export interface MatchedExperience {
  readonly experienceId: ExperienceId
  readonly title: string
  readonly organization: string | null
  readonly kind: ExperienceKind
  readonly score: number
  /** The posting terms found on this experience. */
  readonly matchedTerms: readonly string[]
}

export type MatchExperiencesResult =
  | {
      readonly kind: 'matched'
      readonly jobPostingId: string
      readonly terms: readonly string[]
      readonly matches: readonly MatchedExperience[]
    }
  | {
      readonly kind: 'noParsedRequirements'
      readonly jobPostingId: string
      readonly reason: string
    }
  | { readonly kind: 'notFound'; readonly jobPostingId: string }

export function buildMatchExperiencesTool(
  jobPostings: JobPostingRepository,
): RegisteredTool<MatchExperiencesInput, MatchExperiencesResult> {
  return {
    name: 'matchExperiences',
    description:
      'Rank the experience catalog against a parsed job description and return the strongest matches.',
    risk: 'read',
    parse: (raw: unknown): Result<MatchExperiencesInput> => {
      const parsed = matchExperiencesInputSchema.safeParse(raw)
      return parsed.success ? ok(parsed.data) : err(parsed.error)
    },
    execute: async (
      input: MatchExperiencesInput,
      ctx: ToolContext,
    ): Promise<MatchExperiencesResult> => {
      const posting = await jobPostings.findById(asJobPostingId(input.jobPostingId))
      if (posting === null) return { kind: 'notFound', jobPostingId: input.jobPostingId }
      if (posting.parsed === null) {
        return {
          kind: 'noParsedRequirements',
          jobPostingId: posting.id,
          reason: 'This posting has not been parsed, so there are no requirements to match against.',
        }
      }
      const terms = matchTerms(posting.parsed)
      if (terms.length === 0) {
        return {
          kind: 'noParsedRequirements',
          jobPostingId: posting.id,
          reason: 'The parse produced no keywords, requirements or responsibilities.',
        }
      }
      const matches: MatchedExperience[] = []
      for (const experience of await ctx.experiences.listAll()) {
        const match = scoreExperience(experience, terms)
        if (match !== null) matches.push(match)
      }
      return {
        kind: 'matched',
        jobPostingId: posting.id,
        terms,
        matches: matches.sort(byScoreThenId).slice(0, input.limit ?? DEFAULT_MATCH_LIMIT),
      }
    },
  }
}

/** Deduplicated, order-preserving, lower-cased. */
function matchTerms(parsed: {
  readonly keywords: readonly string[]
  readonly requirements: readonly string[]
  readonly responsibilities: readonly string[]
}): readonly string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of [...parsed.keywords, ...parsed.requirements, ...parsed.responsibilities]) {
    const term = raw.trim().toLowerCase()
    if (term === '' || seen.has(term)) continue
    seen.add(term)
    terms.push(term)
  }
  return terms
}

function scoreExperience(experience: Experience, terms: readonly string[]): MatchedExperience | null {
  const matchedTerms: string[] = []
  let score = 0
  for (const term of terms) {
    let termScore = 0
    if (contains(experience.title, term)) termScore += TITLE_WEIGHT
    if (experience.organization !== null && contains(experience.organization, term)) {
      termScore += ORGANIZATION_WEIGHT
    }
    if (contains(variantText(experience), term)) termScore += BODY_WEIGHT
    if (contains(claimText(experience), term)) termScore += BODY_WEIGHT
    if (contains(detailText(experience.detail), term)) termScore += BODY_WEIGHT
    if (termScore === 0) continue
    matchedTerms.push(term)
    score += termScore
  }
  if (matchedTerms.length === 0) return null
  return {
    experienceId: experience.id,
    title: experience.title,
    organization: experience.organization,
    kind: experience.kind,
    score,
    matchedTerms,
  }
}

function variantText(experience: Experience): string {
  return experience.variants.map((variant) => `${variant.label} ${variant.content}`).join('\n')
}

function claimText(experience: Experience): string {
  return experience.claims.map((claim) => claim.statement).join('\n')
}

function detailText(detail: Readonly<Record<string, unknown>>): string {
  return Object.values(detail)
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? ''))
    .join(' ')
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle)
}

function byScoreThenId(left: MatchedExperience, right: MatchedExperience): number {
  if (left.score !== right.score) return right.score - left.score
  return left.experienceId < right.experienceId ? -1 : 1
}
