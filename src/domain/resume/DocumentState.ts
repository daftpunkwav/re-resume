/**
 * @file DocumentState
 * @description The full editable state of one resume: sections, overrides,
 * template, appearance, page setup and canvas. A revision snapshots exactly this
 * value, which is why undo, redo, agent drafts and the change history all share
 * one mechanism.
 *
 * Responsibilities:
 * - Declare the document state and the pure change function over it
 * - Validate every document invariant before a state is persisted
 *
 * Constraints:
 * - Title and target job are metadata and deliberately absent: renaming a resume
 *   must not appear in its edit history.
 * - `validateResumeDocument` does not check that referenced entries exist
 *   (spec section 5.8): a composition change that removes a dangling reference
 *   must be committable, or the reference could never be cleared.
 * - Pure data: no DOM, no storage, no package.
 */

import type { AgentRunId } from '../shared/branded-id'
import type { AppearanceSettings } from './AppearanceSettings'
import { assertAppearance } from './AppearanceSettings'
import type { CanvasLayout } from './CanvasLayout'
import { assertCanvasLayout } from './CanvasLayout'
import type { PageSetup } from './PageSetup'
import { validatePageSetup } from './PageSetup'
import type { ResumeOverride } from './ResumeOverride'
import { assertOverrideCollection } from './ResumeOverride'
import type { ResumeSection } from './ResumeSection'
import { assertSectionCollection } from './ResumeSection'
import type { TemplateId } from '../shared/branded-id'
import { getTemplate } from './Template'
import { DomainError } from '../shared/DomainError'

export type ChangeOrigin = 'user' | 'agent'

export interface ResumeDocumentState {
  readonly sections: readonly ResumeSection[]
  readonly overrides: readonly ResumeOverride[]
  readonly templateId: TemplateId
  readonly appearance: AppearanceSettings
  readonly pageSetup: PageSetup
  readonly canvas: CanvasLayout
}

/** What gets persisted with each revision; a change adds the transition. */
export interface DocumentChangeMeta {
  readonly label: string
  readonly origin: ChangeOrigin
  readonly runId: AgentRunId | null
}

export interface DocumentChange extends DocumentChangeMeta {
  /** Produces the next document state. Must be pure. */
  readonly next: (state: ResumeDocumentState) => ResumeDocumentState
}

/**
 * Validates the whole document state. This runs after a change function and
 * before the repository writes, so a change that produces an illegal state is
 * refused without touching storage.
 *
 * @throws DomainError `templateNotFound`, `invalidPageSetup`,
 *   `duplicateSection`, `sectionLimitExceeded`, `overrideLimit`,
 *   `canvasBlockOutOfBounds` and the field errors declared by the parts.
 */
export function validateResumeDocument(state: ResumeDocumentState): void {
  const template = getTemplate(state.templateId)
  if (template === null) {
    throw new DomainError('templateNotFound', 'The selected template does not exist.', {
      entity: 'resumeDocument',
      id: state.templateId,
      blockers: [state.templateId],
    })
  }
  validatePageSetup(state.pageSetup, template)
  assertSectionCollection(state.sections)
  for (const section of state.sections) {
    if (section.column > state.pageSetup.columns) {
      throw new DomainError(
        'invalidFieldValue',
        'A section cannot be assigned to a column the page does not have.',
        { entity: 'resumeSection', id: section.id, blockers: [section.id] },
      )
    }
  }
  assertAppearance(state.appearance)
  assertOverrideCollection(state.overrides)
  assertCanvasLayout(state.canvas, state.pageSetup)
}
