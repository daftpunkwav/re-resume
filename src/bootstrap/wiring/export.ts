/**
 * @file export wiring
 * @description Binds the PDF export use cases to the ports the root assembled:
 * the resume store and library the materializer reads, the renderer, the file
 * saver and the attachment storage the canvas images come from.
 *
 * Constraints:
 * - The root decides which renderer and saver exist; this module only binds the
 *   use cases, so the interface never names a PDF package or a dialog plugin.
 */

import type { ExportService } from '../capabilities'
import type { PdfExportDeps } from '../../application/export/exportPdf'
import { exportPdf, preparePdfExport } from '../../application/export/exportPdf'

export type ExportWiringDeps = PdfExportDeps

export function createExportService(deps: PdfExportDeps): ExportService {
  return {
    preparePdfExport: (input) => preparePdfExport(deps, input),
    exportPdf: (input) => exportPdf(deps, input),
  }
}
