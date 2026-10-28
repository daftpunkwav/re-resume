/**
 * @file PageSetup
 * @description Paper size, margins, column count and page numbering for one
 * resume. The paper name is the single truth: the physical extent is derived
 * from `PAPER_DIMENSIONS` rather than stored, so a resume cannot drift into a
 * custom size no printer or exporter knows.
 *
 * Responsibilities:
 * - Declare the paper sizes and the margins bounds
 * - Derive page and content extents from the paper
 * - Validate a page setup against the template that will render it
 *
 * Constraints:
 * - Unit is the typographic point (1/72 inch) throughout.
 * - `validatePageSetup` needs the template because a template declares which
 *   column counts it supports; a page setup alone cannot know.
 * - Pure data: no DOM, no storage, no package.
 */

import { DomainError } from '../shared/DomainError'
import type { TemplateDefinition } from './Template'

export const PAPER_SIZES = ['A4', 'Letter'] as const
export type PaperSize = (typeof PAPER_SIZES)[number]

/** Physical page extents in points. */
export const PAPER_DIMENSIONS: Readonly<
  Record<PaperSize, { readonly width: number; readonly height: number }>
> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
}

export const MARGIN_MIN = 24
export const MARGIN_MAX = 144

/** A content box narrower or shorter than this cannot hold a printed line. */
export const MIN_CONTENT_EXTENT = 240

export interface PageSetup {
  readonly paper: PaperSize
  readonly marginTop: number
  readonly marginRight: number
  readonly marginBottom: number
  readonly marginLeft: number
  readonly columns: 1 | 2
  readonly showPageNumber: boolean
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  paper: 'A4',
  marginTop: 72,
  marginRight: 72,
  marginBottom: 72,
  marginLeft: 72,
  columns: 1,
  showPageNumber: false,
}

export function pageWidth(page: PageSetup): number {
  return PAPER_DIMENSIONS[page.paper].width
}

export function pageHeight(page: PageSetup): number {
  return PAPER_DIMENSIONS[page.paper].height
}

export function contentWidth(page: PageSetup): number {
  return pageWidth(page) - page.marginLeft - page.marginRight
}

export function contentHeight(page: PageSetup): number {
  return pageHeight(page) - page.marginTop - page.marginBottom
}

function invalidPageSetup(field: string, reason: string): DomainError {
  return new DomainError('invalidPageSetup', `The page setup field "${field}" ${reason}.`, {
    entity: 'pageSetup',
    id: field,
    blockers: [field],
  })
}

function assertMargin(field: string, value: number): void {
  if (!Number.isFinite(value) || value < MARGIN_MIN || value > MARGIN_MAX) {
    throw invalidPageSetup(
      field,
      `must be between ${MARGIN_MIN.toString()} and ${MARGIN_MAX.toString()}`,
    )
  }
}

/**
 * Validates a page setup against the template that will render it.
 *
 * @throws DomainError `invalidPageSetup` for an unknown paper, an out-of-range
 *   margin, a column count the template does not support, or a content box too
 *   small to hold the layout.
 */
export function validatePageSetup(page: PageSetup, template: TemplateDefinition): void {
  if (!(PAPER_SIZES as readonly string[]).includes(page.paper)) {
    throw invalidPageSetup('paper', `must be one of ${PAPER_SIZES.join(', ')}`)
  }
  assertMargin('marginTop', page.marginTop)
  assertMargin('marginRight', page.marginRight)
  assertMargin('marginBottom', page.marginBottom)
  assertMargin('marginLeft', page.marginLeft)
  if (page.columns !== 1 && page.columns !== 2) {
    throw invalidPageSetup('columns', 'must be 1 or 2')
  }
  if (!template.supports.columns.includes(page.columns)) {
    throw invalidPageSetup(
      'columns',
      `must be one of ${template.supports.columns.join(', ')} for template "${template.id}"`,
    )
  }
  if (contentWidth(page) <= MIN_CONTENT_EXTENT) {
    throw invalidPageSetup('marginLeft', 'leaves a content box too narrow to render')
  }
  if (contentHeight(page) <= MIN_CONTENT_EXTENT) {
    throw invalidPageSetup('marginTop', 'leaves a content box too short to render')
  }
}

/**
 * Applies a partial patch over the current page setup. The result is not
 * validated here because that needs the template; the calling use case merges
 * and then validates.
 */
export function mergePageSetup(current: PageSetup, patch: Partial<PageSetup>): PageSetup {
  return { ...current, ...patch }
}
