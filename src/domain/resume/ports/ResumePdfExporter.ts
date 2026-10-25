/**
 * @file ResumePdfExporter
 * @description The export interface the infrastructure layer implements to
 * turn a laid-out resume into PDF bytes. Declared in the domain because the
 * application export use case depends on it, and application may only depend
 * on domain types.
 *
 * Responsibilities:
 * - Carry the input an exporter renders: the representation chosen per the
 *   export rules, the page it was laid out for, and the precomputed geometry
 *
 * Constraints:
 * - Implementations draw the lines layout() produced; they never re-wrap or
 *   re-paginate, so the PDF cannot disagree with the canvas and DOCX outputs.
 * - Font registration is the implementation's own concern and must complete
 *   before the first glyph is drawn.
 */

import type { PageSetup } from '../PageSetup'
import type { LayoutOutput } from '../PageLayout'
import type { MaterializedBlock } from '../ResumeSnapshot'

/** Everything a PDF exporter needs; every reference is already resolved. */
export interface PdfExportInput {
  readonly blocks: readonly MaterializedBlock[]
  readonly page: PageSetup
  readonly laidOut: LayoutOutput
}

export interface ResumePdfExporter {
  /** Renders the input to raw PDF file bytes. */
  render(input: PdfExportInput): Promise<Uint8Array>
}
