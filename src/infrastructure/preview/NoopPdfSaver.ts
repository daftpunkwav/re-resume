/**
 * @file NoopPdfSaver
 * @description The PDF sink of the preview window. A browser session has no
 * save dialog, so a save request reports "dismissed" the way the real dialog
 * does when the user closes it.
 *
 * Constraints:
 * - Preview assembly only; no file system access.
 */

import type { PdfFileSaver } from '../../domain/resume/ports/PdfFileSaver'

export class NoopPdfSaver implements PdfFileSaver {
  async save(_bytes: Uint8Array, _suggestedName: string): Promise<string | null> {
    return null
  }
}
