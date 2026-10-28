/**
 * @file setTemplate
 * @description Switches the resume to another built-in template without losing
 * content: sections, overrides and canvas stay, the appearance takes the new
 * template's defaults while keeping the user's accent colour, and the page takes
 * the template's default setup while keeping paper and page numbering.
 *
 * Constraints:
 * - A template declares the column counts it supports; a document that no longer
 *   supports the chosen page falls back to a supported column count, and sections
 *   are clamped so the document invariant holds.
 * - The change goes through `commitResumeChange`, so switching back is one undo.
 */

import type { ResumeId, TemplateId } from '../../domain/shared/branded-id'
import type { Revision } from '../../domain/resume/Revision'
import type { ResumeDocumentState } from '../../domain/resume/DocumentState'
import { getTemplate, SIDEBAR_MODULE_KINDS } from '../../domain/resume/Template'
import type { TemplateDefinition } from '../../domain/resume/Template'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import { DomainError } from '../../domain/shared/DomainError'
import type { ChangeProvenance, ResumeStoreDeps } from './resumeSource'
import { changeMeta, loadResume } from './resumeSource'
import { commitResumeChange } from './commitResumeChange'

export interface SetTemplateInput extends ChangeProvenance {
  readonly resumeId: ResumeId
  readonly templateId: TemplateId
}

export interface SetTemplateOutput {
  readonly revision: Revision
}

export async function setTemplate(
  deps: ResumeStoreDeps,
  input: SetTemplateInput,
): Promise<SetTemplateOutput> {
  const template = requireTemplate(input.templateId)
  await loadResume(deps.resumes, input.resumeId)
  const revision = await commitResumeChange(deps, input.resumeId, {
    ...changeMeta('切换模板', input),
    next: (state) => applyTemplate(state, template),
  })
  return { revision }
}

/** Applies the template defaults while preserving the user's explicit choices. */
export function applyTemplate(
  state: ResumeDocumentState,
  template: TemplateDefinition,
): ResumeDocumentState {
  const appearance = {
    ...template.defaults.appearance,
    accentColor: state.appearance.accentColor,
  }
  const columns = template.supports.columns.includes(template.defaults.pageSetup.columns)
    ? template.defaults.pageSetup.columns
    : (template.supports.columns[0] ?? 1)
  const pageSetup = {
    ...template.defaults.pageSetup,
    paper: state.pageSetup.paper,
    showPageNumber: state.pageSetup.showPageNumber,
    columns,
  }
  return {
    ...state,
    templateId: template.id,
    appearance,
    pageSetup,
    sections: state.sections.map((section) => ({
      ...section,
      column: columnOf(pageSetup.columns, section.moduleKind),
    })),
  }
}

/**
 * A single-column page puts every chapter in column 1. A two-column page assigns
 * the sidebar modules to column 1 and everything else to column 2: keeping the
 * previous assignment would leave chapters pointing at a column the new
 * template's layout never fills.
 */
function columnOf(columns: 1 | 2, moduleKind: InfoModuleKind): 1 | 2 {
  if (columns === 1) return 1
  return SIDEBAR_MODULE_KINDS.has(moduleKind) ? 1 : 2
}

function requireTemplate(templateId: TemplateId): TemplateDefinition {
  const template = getTemplate(templateId)
  if (template === null) {
    throw new DomainError('templateNotFound', 'The selected template does not exist.', {
      entity: 'resume',
      id: templateId,
      blockers: [templateId],
    })
  }
  return template
}
