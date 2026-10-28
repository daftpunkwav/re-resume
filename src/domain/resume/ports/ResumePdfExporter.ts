/**
 * @file ResumePdfExporter
 * @description The interface the infrastructure layer implements to turn a
 * laid-out resume into PDF bytes. Declared in the domain because the export use
 * case depends on it and the application layer may only depend on domain types.
 *
 * Responsibilities:
 * - Carry everything a renderer needs: the materialized blocks (for roles and
 *   images), the page, the precomputed geometry, the appearance and the template
 *
 * Constraints:
 * - Implementations draw the lines `layout()` produced; they never re-wrap or
 *   re-paginate, so the PDF cannot disagree with the canvas.
 * - Font registration is the implementation's own concern and must complete
 *   before the first glyph is drawn.
 */

import type { AppearanceSettings } from '../AppearanceSettings'
import type { LayoutBlock } from '../Layout'
import type { LayoutOutput } from '../PageLayout'
import type { PageSetup } from '../PageSetup'
import type { TemplateDefinition } from '../Template'

export interface PdfExportInput {
  readonly blocks: readonly LayoutBlock[]
  readonly page: PageSetup
  readonly laidOut: LayoutOutput
  readonly appearance: AppearanceSettings
  readonly template: TemplateDefinition
  /** Name drawn in the page header when the template splits the header. */
  readonly headerName: string | null
  /**
   * Image data URLs by attachment id, for the canvas image blocks the export
   * resolved. An id missing here draws the missing-image placeholder; the
   * renderer never reads storage itself.
   */
  readonly images: ReadonlyMap<string, string>
}

export interface ResumePdfExporter {
  /** Renders the input to raw PDF file bytes. */
  render(input: PdfExportInput): Promise<Uint8Array>
}
