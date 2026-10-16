/**
 * @file PageSetup
 * @description Paper size and margins for one resume.
 */

export interface PageSetup {
  /** Unit: points. A4 is 595.28 x 841.89. */
  readonly pageWidth: number
  readonly pageHeight: number
  /** Page grid columns. Stage one implements 1 only. */
  readonly columns: 1 | 2
  readonly marginTop: number
  readonly marginRight: number
  readonly marginBottom: number
  readonly marginLeft: number
}

export const A4_PAGE_SETUP: PageSetup = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  columns: 1,
  marginTop: 72,
  marginRight: 72,
  marginBottom: 72,
  marginLeft: 72,
}

export function contentWidth(page: PageSetup): number {
  return page.pageWidth - page.marginLeft - page.marginRight
}

export function contentHeight(page: PageSetup): number {
  return page.pageHeight - page.marginTop - page.marginBottom
}
