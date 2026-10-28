/**
 * @file sectionSelection
 * @description The shared composition rule behind `setSectionSelection` and
 * `createResume`'s initial selection. It validates the entries a chapter names,
 * creates the chapter in canonical order when it does not exist yet, and
 * replaces the selection in place otherwise.
 *
 * Constraints:
 * - The selection is validated against the library on write only; the read path
 *   tolerates stale references (spec section 4.14).
 * - A section is identified by (moduleKind, customModuleId); a second selection
 *   of one module replaces the first rather than creating a duplicate.
 */

import type { CustomModuleId, InfoEntryId, ResumeSectionId } from '../../domain/shared/branded-id'
import { asResumeSectionId } from '../../domain/shared/branded-id'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import type { InfoEntryRepository } from '../../domain/info/ports/InfoEntryRepository'
import type { ResumeDocumentState } from '../../domain/resume/DocumentState'
import type { ResumeSection } from '../../domain/resume/ResumeSection'
import {
  insertSectionCanonical,
  renumberSections,
  sectionEntryLimit,
  sectionKey,
} from '../../domain/resume/ResumeSection'
import { SIDEBAR_MODULE_KINDS } from '../../domain/resume/Template'
import { DomainError } from '../../domain/shared/DomainError'
import type { IdGenerator } from '../../domain/shared/IdGenerator'

/** One chapter's requested selection. */
export interface SectionSelection {
  readonly moduleKind: InfoModuleKind
  readonly customModuleId?: CustomModuleId | null
  readonly entryIds: readonly InfoEntryId[]
}

export interface SectionSelectionDeps {
  readonly entries: InfoEntryRepository
}

function moduleKindMismatch(message: string, id: string): DomainError {
  return new DomainError('moduleKindMismatch', message, {
    entity: 'resumeSection',
    id,
    blockers: [id],
  })
}

function entryNotFound(id: InfoEntryId): DomainError {
  return new DomainError('entryNotFound', 'The information entry does not exist.', {
    entity: 'infoEntry',
    id,
    blockers: [id],
  })
}

/**
 * Validates a selection against the library.
 *
 * @throws DomainError `moduleKindMismatch` for a module/entry association the
 *   model does not allow, `entryNotFound` for an unknown entry,
 *   `sectionLimitExceeded` past the module's selection limit.
 */
export async function validateSelection(
  deps: SectionSelectionDeps,
  selection: SectionSelection,
): Promise<void> {
  const customModuleId = selection.customModuleId ?? null
  if ((selection.moduleKind === 'custom') !== (customModuleId !== null)) {
    throw moduleKindMismatch(
      'A custom section names its custom module; a built-in section does not.',
      customModuleId ?? selection.moduleKind,
    )
  }
  const limit = sectionEntryLimit(selection.moduleKind)
  if (selection.entryIds.length > limit) {
    throw new DomainError(
      'sectionLimitExceeded',
      `A ${selection.moduleKind} section may select at most ${limit.toString()} entries.`,
      { entity: 'resumeSection', id: selection.moduleKind, blockers: [selection.moduleKind] },
    )
  }
  const seen = new Set<string>()
  for (const entryId of selection.entryIds) {
    if (seen.has(entryId)) {
      throw new DomainError(
        'invalidFieldValue',
        'A section cannot select the same entry twice.',
        { entity: 'resumeSection', id: selection.moduleKind, blockers: [entryId] },
      )
    }
    seen.add(entryId)
    const entry = await deps.entries.findById(entryId)
    if (entry === null) throw entryNotFound(entryId)
    if (
      entry.moduleKind !== selection.moduleKind ||
      entry.customModuleId !== customModuleId
    ) {
      throw moduleKindMismatch(
        'The selected entry belongs to a different module.',
        entryId,
      )
    }
  }
}

/** The column a new section starts in for the current page. */
function initialColumn(pageColumns: 1 | 2, moduleKind: InfoModuleKind): 1 | 2 {
  if (pageColumns === 1) return 1
  return SIDEBAR_MODULE_KINDS.has(moduleKind) ? 1 : 2
}

/**
 * Applies one already-validated selection to a state. A section that already
 * exists keeps its identifier, name, visibility and column; otherwise the
 * provided identifier creates a section at the canonical position.
 */
export function selectSection(
  state: ResumeDocumentState,
  selection: SectionSelection,
  newSectionId: ResumeSectionId | null,
): ResumeDocumentState {
  const customModuleId = selection.customModuleId ?? null
  const key = sectionKey(selection.moduleKind, customModuleId)
  const existing = state.sections.find(
    (section) => sectionKey(section.moduleKind, section.customModuleId) === key,
  )
  if (existing !== undefined) {
    return {
      ...state,
      sections: state.sections.map((section) =>
        section.id === existing.id ? { ...section, entryIds: [...selection.entryIds] } : section,
      ),
    }
  }
  if (newSectionId === null) {
    throw new DomainError('sectionNotFound', 'The section to update does not exist.', {
      entity: 'resumeSection',
      id: key,
      blockers: [key],
    })
  }
  const section: ResumeSection = {
    id: newSectionId,
    moduleKind: selection.moduleKind,
    customModuleId,
    displayName: null,
    entryIds: [...selection.entryIds],
    visible: true,
    column: initialColumn(state.pageSetup.columns, selection.moduleKind),
    sortOrder: state.sections.length + 1,
  }
  return { ...state, sections: insertSectionCanonical(state.sections, section) }
}

/**
 * Applies one selection to a document state: replaces the entries of the
 * chapter, or creates the chapter at its canonical position.
 */
export async function applySectionSelection(
  deps: SectionSelectionDeps,
  ids: IdGenerator,
  state: ResumeDocumentState,
  selection: SectionSelection,
): Promise<ResumeDocumentState> {
  await validateSelection(deps, selection)
  return selectSection(state, selection, asResumeSectionId(ids.next()))
}

/**
 * Reorders the sections to the given identifiers. The caller validated the set
 * against the state it read; a state that changed in between is refused rather
 * than reordered against a different collection.
 *
 * @throws DomainError `sectionNotFound` for an identifier the document lacks.
 */
export function reorderSections(
  state: ResumeDocumentState,
  orderedSectionIds: readonly ResumeSectionId[],
): ResumeDocumentState {
  if (orderedSectionIds.length !== state.sections.length) {
    throw new DomainError('sectionNotFound', 'The section order must name every section.', {
      entity: 'resume',
      id: '',
      blockers: [...orderedSectionIds],
    })
  }
  const reordered = orderedSectionIds.map((id) => {
    const section = state.sections.find((candidate) => candidate.id === id)
    if (section === undefined) {
      throw new DomainError('sectionNotFound', 'The section does not exist.', {
        entity: 'resumeSection',
        id,
        blockers: [id],
      })
    }
    return section
  })
  return { ...state, sections: renumberSections(reordered) }
}
