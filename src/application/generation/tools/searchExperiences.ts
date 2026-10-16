/**
 * @file searchExperiences
 * @description Keyword search over the experience catalog. Matching runs in
 * memory over the loaded rows: the catalog is one person's history, and the
 * search is a narrowing step for the model rather than a retrieval index.
 *
 * Constraints:
 * - read level, so it writes nothing and returns a projection, never an
 *   Experience aggregate the model could quote as fact.
 * - Ranking weights are declared once here; the whole result is stable for a
 *   given catalog because ties break on the experience id.
 */

import { z } from 'zod'
import type { Experience } from '../../../domain/catalog/Experience'
import type { ExperienceKind } from '../../../domain/catalog/ExperienceKind'
import type { Result } from '../../../domain/shared/Result'
import type { ExperienceId } from '../../../domain/shared/branded-id'
import { err, ok } from '../../../domain/shared/Result'
import type { RegisteredTool, ToolContext } from '../../../domain/generation/ports/ToolRegistry'

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 50

export const searchExperiencesInputSchema = z.object({
  keyword: z.string().trim().min(1),
  limit: z.number().int().positive().max(MAX_SEARCH_LIMIT).optional(),
}).strict()

export interface SearchExperiencesInput {
  readonly keyword: string
  readonly limit?: number
}

export interface ExperienceHit {
  readonly experienceId: ExperienceId
  readonly title: string
  readonly organization: string | null
  readonly kind: ExperienceKind
  /** Which fields the keyword was found in, so a hit is explainable. */
  readonly matchedOn: readonly string[]
  readonly score: number
}

const TITLE_WEIGHT = 3
const ORGANIZATION_WEIGHT = 2
const BODY_WEIGHT = 1

export const searchExperiences: RegisteredTool<
  SearchExperiencesInput,
  readonly ExperienceHit[]
> = {
  name: 'searchExperiences',
  description:
    'Find experiences by keyword. Reads the catalog and returns ranked hits; it changes nothing.',
  risk: 'read',
  parse: (raw: unknown): Result<SearchExperiencesInput> => {
    const parsed = searchExperiencesInputSchema.safeParse(raw)
    return parsed.success ? ok(parsed.data) : err(parsed.error)
  },
  execute: async (
    input: SearchExperiencesInput,
    ctx: ToolContext,
  ): Promise<readonly ExperienceHit[]> => {
    const limit = input.limit ?? DEFAULT_SEARCH_LIMIT
    const keyword = input.keyword.toLowerCase()
    const hits: ExperienceHit[] = []
    for (const experience of await ctx.experiences.listAll()) {
      const hit = scoreExperience(experience, keyword)
      if (hit !== null) hits.push(hit)
    }
    return hits.sort(byScoreThenId).slice(0, limit)
  },
}

function scoreExperience(experience: Experience, keyword: string): ExperienceHit | null {
  const matchedOn: string[] = []
  let score = 0
  if (contains(experience.title, keyword)) {
    matchedOn.push('title')
    score += TITLE_WEIGHT
  }
  if (experience.organization !== null && contains(experience.organization, keyword)) {
    matchedOn.push('organization')
    score += ORGANIZATION_WEIGHT
  }
  for (const variant of experience.variants) {
    if (contains(variant.label, keyword) || contains(variant.content, keyword)) {
      matchedOn.push('variant')
      score += BODY_WEIGHT
      break
    }
  }
  for (const claim of experience.claims) {
    if (contains(claim.statement, keyword)) {
      matchedOn.push('claim')
      score += BODY_WEIGHT
      break
    }
  }
  if (contains(detailText(experience.detail), keyword)) {
    matchedOn.push('detail')
    score += BODY_WEIGHT
  }
  if (matchedOn.length === 0) return null
  return {
    experienceId: experience.id,
    title: experience.title,
    organization: experience.organization,
    kind: experience.kind,
    matchedOn,
    score,
  }
}

function detailText(detail: Readonly<Record<string, unknown>>): string {
  return Object.values(detail)
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? ''))
    .join(' ')
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle)
}

function byScoreThenId(left: ExperienceHit, right: ExperienceHit): number {
  if (left.score !== right.score) return right.score - left.score
  return left.experienceId < right.experienceId ? -1 : 1
}
