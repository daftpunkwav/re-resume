/**
 * @file BrowserDownloadPdfSaver
 * @description PdfFileSaver for the browser preview: instead of a native save
 * dialog, the bytes are handed to the browser as a download. The browser owns
 * the destination directory, so the returned value is the file name the user
 * sees in the download list, not an absolute path.
 *
 * Constraints:
 * - Only the preview root constructs this. The native window uses the Tauri
 *   saver, and the production bundle does not contain this module.
 * - The object URL is released after the click; leaving it alive would pin the
 *   PDF bytes in memory for the lifetime of the window.
 */

import type { PdfFileSaver } from '../../domain/resume/ports/PdfFileSaver'
import { sanitizePdfFileName } from './pdfFileName'

export class BrowserDownloadPdfSaver implements PdfFileSaver {
  async save(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('当前环境没有浏览器下载能力，无法保存 PDF。')
    }
    const fileName = sanitizePdfFileName(suggestedName)
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
      return fileName
    } finally {
      // The download has started by the time click() returns; releasing the URL
      // on the next task lets slow browsers finish reading it first.
      setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 0)
    }
  }
}
