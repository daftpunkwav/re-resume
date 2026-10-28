/**
 * @file ResumeSection
 * @description One chapter of a resume: the module it draws from, the entries it
 * selects in render order, and the display decisions around them. A section is
 * what makes a resume a composition rather than a copy: it holds entry
 * identifiers, never entry content, so a library edit never silently rewrites a
 * saved resume.
 *
 * Responsibilities:
 * - Declare a section and the canonical chapter order a new resume starts in
 * - Validate the section invariants: unique module, dense order, entry limits
 * - Resolve the heading a section renders with
 * - Insert a section at the canonical position and renumber densely
 *
 * Constraints:
 * - `personal` and `jobIntent` select at most one entry; every other module at
 *   most `SECTION_ENTRY_LIMIT`.
 * - Entry identifiers are not foreign keys: a stale one is reported as a
 *   missing reference, never repaired here.
 * - Pure data: no DOM, no storage, no package.
 */

import type { CustomModuleId, InfoEntryId, ResumeSectionId } from '../shared/branded-id'
import { DomainError } from '../shared/DomainError'
import type { CustomModuleDefinition } from '../info/CustomModule'
import { MODULE_DESCRIPTORS } from '../info/InfoModuleKind'
import type { InfoModuleKind } from '../info/InfoModuleKind'
import { countCodePoints } from '../info/codePoints'

/** Longest accepted custom section heading, in code points. */
export const SECTION_DISPLAY_NAME_MAX_LENGTH = 24

/** Entries a section may select when its module declares no lower bound. */
export const SECTION_ENTRY_LIMIT = 50

/**
 * Canonical chapter order a new resume starts in. Custom modules follow the
 * built-in chapters, in custom-module order.
 */
export const CANONICAL_SECTION_ORDER: readonly InfoModuleKind[] = [
  'personal',
  'jobIntent',
  'education',
  'internship',
  'project',
  'skill',
  'award',
  'selfEvaluation',
  'custom',
]

export interface ResumeSection {
  readonly id: ResumeSectionId
  readonly moduleKind: InfoModuleKind
  readonly customModuleId: CustomModuleId | null
  /** null = the module's default name; 1..24 code points otherwise. */
  readonly displayName: string | null
  /** Render order inside the chapter. */
  readonly entryIds: readonly InfoEntryId[]
  readonly visible: boolean
  /** Only meaningful for two-column templates; single-column output is 1. */
  readonly column: 1 | 2
  /** 1..n, dense and unique. */
  readonly sortOrder: number
}

function sectionError(
  code:
    | 'duplicateSection'
    | 'sectionLimitExceeded'
    | 'fieldTooLong'
    | 'moduleKindMismatch'
    | 'invalidFieldValue'
    | 'sectionNotFound',
  message: string,
  id: string,
  blockers: readonly string[] = [],
): DomainError {
  return new DomainError(code, message, { entity: 'resumeSection', id, blockers })
}

/** The identity the uniqueness rule is stated on. */
export function sectionKey(moduleKind: InfoModuleKind, customModuleId: CustomModuleId | null): string {
  return `${moduleKind}:${customModuleId ?? ''}`
}

/** How many entries the section may select, from its module's descriptor. */
export function sectionEntryLimit(moduleKind: InfoModuleKind): number {
  return MODULE_DESCRIPTORS[moduleKind].maxSelectedEntries ?? SECTION_ENTRY_LIMIT
}

/** Rank in the canonical chapter order; custom chapters share the last rank. */
function canonicalRank(moduleKind: InfoModuleKind): number {
  const rank = CANONICAL_SECTION_ORDER.indexOf(moduleKind)
  return rank === -1 ? CANONICAL_SECTION_ORDER.length : rank
}

/**
 * Trims a display name and turns a blank one into null. The trimmed value is
 * what gets stored, so the model never holds surrounding whitespace.
 *
 * @throws DomainError `fieldTooLong` past the code-point bound.
 */
export function normalizeSectionDisplayName(raw: string | null): string | null {
  if (raw === null) return null
  const name = raw.trim()
  if (name === '') return null
  if (countCodePoints(name) > SECTION_DISPLAY_NAME_MAX_LENGTH) {
    throw sectionError(
      'fieldTooLong',
      `A section name may be at most ${SECTION_DISPLAY_NAME_MAX_LENGTH.toString()} characters.`,
      'displayName',
      ['displayName'],
    )
  }
  return name
}

/** The heading text: the user's name when set, the module's default otherwise. */
export function sectionDisplayName(
  section: ResumeSection,
  customModule: CustomModuleDefinition | null,
): string {
  if (section.displayName !== null) return section.displayName
  if (section.moduleKind === 'custom') {
    return customModule?.name ?? MODULE_DESCRIPTORS.custom.defaultSectionName
  }
  return MODULE_DESCRIPTORS[section.moduleKind].defaultSectionName
}

function assertSectionShape(section: ResumeSection): void {
  const customIsNamed = section.customModuleId !== null
  if ((section.moduleKind === 'custom') !== customIsNamed) {
    throw sectionError(
      'moduleKindMismatch',
      'A custom section names its custom module; a built-in section does not.',
      section.id,
      [section.id],
    )
  }
  if (section.column !== 1 && section.column !== 2) {
    throw sectionError('invalidFieldValue', 'A section column must be 1 or 2.', section.id)
  }
  if (!Number.isInteger(section.sortOrder) || section.sortOrder < 1) {
    throw sectionError('invalidFieldValue', 'A section order must be a positive integer.', section.id)
  }
  assertUniqueEntryIds(section)
  assertSelectionLimit(section)
  assertSectionDisplayName(section)
}

function assertUniqueEntryIds(section: ResumeSection): void {
  const entries = new Set<string>()
  for (const entryId of section.entryIds) {
    if (entries.has(entryId)) {
      throw sectionError(
        'invalidFieldValue',
        'A section cannot select the same entry twice.',
        section.id,
        [entryId],
      )
    }
    entries.add(entryId)
  }
}

function assertSelectionLimit(section: ResumeSection): void {
  const limit = sectionEntryLimit(section.moduleKind)
  if (section.entryIds.length > limit) {
    throw sectionError(
      'sectionLimitExceeded',
      `A ${section.moduleKind} section may select at most ${limit.toString()} entries.`,
      section.id,
      [section.id],
    )
  }
}

function assertSectionDisplayName(section: ResumeSection): void {
  if (section.displayName === null) return
  const trimmed = section.displayName.trim()
  if (
    trimmed === '' ||
    trimmed !== section.displayName ||
    countCodePoints(trimmed) > SECTION_DISPLAY_NAME_MAX_LENGTH
  ) {
    throw sectionError(
      'fieldTooLong',
      'A section name is 1 to 24 characters and carries no surrounding whitespace.',
      section.id,
    )
  }
}

/**
 * Validates the identity, order and per-section rules of a section collection.
 *
 * @throws DomainError `duplicateSection`, `sectionLimitExceeded`,
 *   `moduleKindMismatch` or `invalidFieldValue`.
 */
export function assertSectionCollection(sections: readonly ResumeSection[]): void {
  const identities = new Set<string>()
  const orders = new Set<number>()
  for (const section of sections) {
    assertSectionShape(section)
    assertUniqueSectionIdentity(section, identities)
    assertUniqueSectionOrder(section, orders)
  }
  assertDenseSectionOrders(orders, sections.length)
}

function assertUniqueSectionIdentity(
  section: ResumeSection,
  identities: Set<string>,
): void {
  const key = sectionKey(section.moduleKind, section.customModuleId)
  if (identities.has(key)) {
    throw sectionError(
      'duplicateSection',
      'A module may appear as one section only.',
      section.id,
      [key],
    )
  }
  identities.add(key)
}

function assertUniqueSectionOrder(section: ResumeSection, orders: Set<number>): void {
  if (orders.has(section.sortOrder)) {
    throw sectionError(
      'invalidFieldValue',
      'Section orders must be unique.',
      section.id,
      [section.sortOrder.toString()],
    )
  }
  orders.add(section.sortOrder)
}

/** Orders are 1..n with no gaps, so the document order is unambiguous. */
function assertDenseSectionOrders(orders: ReadonlySet<number>, length: number): void {
  for (let order = 1; order <= length; order += 1) {
    if (!orders.has(order)) {
      throw sectionError(
        'invalidFieldValue',
        'Section orders must be dense, from 1 to the number of sections.',
        String(order),
      )
    }
  }
}

/** Rewrites `sortOrder` to 1..n in array order. */
export function renumberSections(sections: readonly ResumeSection[]): readonly ResumeSection[] {
  return sections.map((section, index) => ({ ...section, sortOrder: index + 1 }))
}

/**
 * Finds one section or refuses with the contract's code.
 *
 * @throws DomainError `sectionNotFound`.
 */
export function requireSection(
  sections: readonly ResumeSection[],
  sectionId: ResumeSectionId,
): ResumeSection {
  const section = sections.find((candidate) => candidate.id === sectionId)
  if (section === undefined) {
    throw sectionError('sectionNotFound', 'The section does not exist.', sectionId, [sectionId])
  }
  return section
}

/**
 * Inserts a section at the canonical chapter position and renumbers. Custom
 * chapters always follow the built-in ones, in insertion order.
 */
export function insertSectionCanonical(
  sections: readonly ResumeSection[],
  section: ResumeSection,
): readonly ResumeSection[] {
  const rank = canonicalRank(section.moduleKind)
  let index = sections.length
  if (section.moduleKind !== 'custom') {
    index = sections.findIndex(
      (existing) =>
        existing.moduleKind === 'custom' || canonicalRank(existing.moduleKind) > rank,
    )
    if (index === -1) index = sections.length
  }
  const inserted = [...sections.slice(0, index), section, ...sections.slice(index)]
  return renumberSections(inserted)
}
