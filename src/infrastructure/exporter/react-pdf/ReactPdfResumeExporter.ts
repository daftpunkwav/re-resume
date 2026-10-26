/**
 * @file ReactPdfResumeExporter
 * @description The ResumePdfExporter port implemented on @react-pdf/renderer.
 *
 * Responsibilities:
 * - Register the registry's fonts before the first render
 * - Render the document tree to PDF bytes
 *
 * Constraints:
 * - Font registration happens inside render and is idempotent, so the caller
 *   cannot reach a render with unregistered faces by constructing this object
 *   at the wrong moment.
 * - The renderer draws in the WebView; no external process is involved.
 */

import { pdf } from '@react-pdf/renderer'

import type { PdfExportInput, ResumePdfExporter } from '../../../domain/resume/ports/ResumePdfExporter'
import type { FontRegistry } from '../../measurement/FontRegistry'
import { registerPdfFonts } from './registerPdfFonts'
import { buildPdfDocument } from './buildPdfDocument'

export class ReactPdfResumeExporter implements ResumePdfExporter {
  readonly #fonts: FontRegistry

  constructor(fonts: FontRegistry) {
    this.#fonts = fonts
  }

  async render(input: PdfExportInput): Promise<Uint8Array> {
    await registerPdfFonts(this.#fonts)
    const blob = await pdf(buildPdfDocument(input)).toBlob()
    return new Uint8Array(await blob.arrayBuffer())
  }
}
