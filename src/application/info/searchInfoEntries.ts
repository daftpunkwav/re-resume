/**
 * @file searchInfoEntries
 * @description In-memory keyword search over the library: the title weighs three,
 * each matching field weighs one, and ties are settled by recency. The library is
 * sized for a single person, so a scan is cheaper than an index and never turns a
 * stale index into a wrong answer.
 *
 * Constraints:
 * - Matching is case-insensitive substring over the title and the text field
 *   values; CJK and emoji match at code-point granularity.
 * - The result carries the field keys that matched, so the interface can point at
 *   what matched rather than merely showing the entry.
 * - Search is a read: it changes neither time nor identifiers.
 */

import type { InfoEntry, } from '../../domain/info/InfoEntry'
import type { InfoFieldValue } from '../../domain/info/InfoFieldValue'
import { INFO_MODULE_KINDS } from '../../domain/info/InfoModuleKind'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import { countCodePoints, truncateCodePoints } from '../../domain/info/codePoints'
import { DomainError } from '../../domain/shared/DomainError'
import type { DateTime } from '../../domain/shared/DateTime'
import type { InfoEntryId } from '../../domain/shared/branded-id'
import type { InfoLibraryDeps } from './library'

/** Longest keyword the contract accepts. */
export const SEARCH_KEYWORD_MAX_LENGTH = 60

/** Default and maximum number of hits. */
export const SEARCH_DEFAULT_LIMIT = 20
export const SEARCH_MAX_LIMIT = 50

/** Code points of a matching value kept in the snippet. */
const SNIPPET_LENGTH = 60

/** The title counts three times: it is what the user searches for in a list. */
const TITLE_WEIGHT = 3
const FIELD_WEIGHT = 1

export interface SearchInfoEntriesInput {
  readonly keyword: string
  readonly moduleKinds?: readonly InfoModuleKind[]
  /** Defaults to 20; clamped to 1..50. */
  readonly limit?: number
}

export interface InfoSearchHit {
  readonly entryId: InfoEntryId
  readonly moduleKind: InfoModuleKind
  readonly title: string
  /** 'title' plus the keys of the fields that matched. */
  readonly matchedOn: readonly string[]
  readonly score: number
  /** Excerpt around the first match the search found. */
  readonly snippet: string
}

export interface SearchInfoEntriesOutput {
  readonly hits: readonly InfoSearchHit[]
}

/** A hit plus the field search ranks with but does not expose. */
interface ScoredHit {
  readonly hit: InfoSearchHit
  readonly updatedAt: DateTime
}

export async function searchInfoEntries(
  deps: InfoLibraryDeps,
  input: SearchInfoEntriesInput,
): Promise<SearchInfoEntriesOutput> {
  const keyword = input.keyword.trim()
  if (keyword === '') {
    throw new DomainError('blankRequiredField', 'The search keyword is required.', {
      entity: 'infoSearch',
      id: 'keyword',
      blockers: ['keyword'],
    })
  }
  if (countCodePoints(keyword) > SEARCH_KEYWORD_MAX_LENGTH) {
    throw new DomainError(
      'fieldTooLong',
      `The search keyword may be at most ${SEARCH_KEYWORD_MAX_LENGTH.toString()} characters.`,
      { entity: 'infoSearch', id: 'keyword', blockers: ['keyword'] },
    )
  }
  const moduleKinds = validateModuleKinds(input.moduleKinds)
  const limit = clampLimit(input.limit)
  const needle = keyword.toLowerCase()
  const entries = await deps.entries.listAll()
  const scored: ScoredHit[] = []
  for (const entry of entries) {
    if (moduleKinds !== null && !moduleKinds.has(entry.moduleKind)) continue
    const hit = matchEntry(entry, needle)
    if (hit !== null) scored.push({ hit, updatedAt: entry.updatedAt })
  }
  scored.sort(compareScoredHits)
  return { hits: scored.slice(0, limit).map((entry) => entry.hit) }
}

/** @throws DomainError `invalidFieldValue` for a kind this build does not know. */
function validateModuleKinds(
  moduleKinds: readonly InfoModuleKind[] | undefined,
): ReadonlySet<InfoModuleKind> | null {
  if (moduleKinds === undefined) return null
  const valid = new Set<InfoModuleKind>()
  for (const kind of moduleKinds) {
    if (!(INFO_MODULE_KINDS as readonly string[]).includes(kind)) {
      throw new DomainError('invalidFieldValue', `"${String(kind)}" is not a module kind.`, {
        entity: 'infoSearch',
        id: 'moduleKinds',
        blockers: [String(kind)],
      })
    }
    valid.add(kind)
  }
  return valid
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_DEFAULT_LIMIT
  return Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

function matches(value: InfoFieldValue, needle: string): value is string {
  return typeof value === 'string' && value.toLowerCase().includes(needle)
}

function matchEntry(entry: InfoEntry, needle: string): InfoSearchHit | null {
  const titleMatched = entry.title.toLowerCase().includes(needle)
  const matchedFields: string[] = []
  for (const [key, value] of Object.entries(entry.fields)) {
    if (matches(value, needle)) matchedFields.push(key)
  }
  if (!titleMatched && matchedFields.length === 0) return null
  const matchedOn = titleMatched ? ['title', ...matchedFields] : matchedFields
  const score = (titleMatched ? TITLE_WEIGHT : 0) + matchedFields.length * FIELD_WEIGHT
  return {
    entryId: entry.id,
    moduleKind: entry.moduleKind,
    title: entry.title,
    matchedOn,
    score,
    snippet: snippetOf(entry, needle, titleMatched, matchedFields),
  }
}

function snippetOf(
  entry: InfoEntry,
  needle: string,
  titleMatched: boolean,
  matchedFields: readonly string[],
): string {
  if (titleMatched) return truncateCodePoints(entry.title, SNIPPET_LENGTH)
  const firstField = matchedFields[0]
  const value = firstField === undefined ? null : entry.fields[firstField]
  if (typeof value !== 'string') return truncateCodePoints(entry.title, SNIPPET_LENGTH)
  const matchIndex = value.toLowerCase().indexOf(needle)
  if (matchIndex === -1) return truncateCodePoints(value, SNIPPET_LENGTH)
  return truncateCodePoints(value.slice(matchIndex), SNIPPET_LENGTH)
}

/** Higher score first, then the more recently updated entry, then the identifier. */
function compareScoredHits(left: ScoredHit, right: ScoredHit): number {
  if (left.hit.score !== right.hit.score) return right.hit.score - left.hit.score
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1
  return left.hit.entryId < right.hit.entryId ? -1 : left.hit.entryId > right.hit.entryId ? 1 : 0
}
