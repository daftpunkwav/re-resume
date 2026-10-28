/**
 * @file BundledFontPdfExporter
 * @description Factories for the two roots' PDF exporters, sharing one rule:
 * the renderer package is imported on the first export, never at boot. The
 * preview also has no registry at build time, so it loads the bundled faces
 * lazily as well.
 *
 * Constraints:
 * - The renderer chunk is created once per exporter and retried after a failed
 *   first render, so a transient font or renderer failure does not poison every
 *   later export.
 * - The bundled faces are the only faces the PDF may draw with; a fallback
 *   family would move glyphs away from the measured advances.
 */

import type { ResumePdfExporter } from '../../../domain/resume/ports/ResumePdfExporter'
import { loadBundledFontRegistry } from '../../measurement/BundledFontRegistry'
import type { FontRegistry } from '../../measurement/FontRegistry'

/**
 * An exporter over an already loaded registry. The renderer and the document
 * builder are imported on first use, so a window that never exports does not
 * pay for the PDF chunk at boot.
 */
export function createPdfExporter(fonts: FontRegistry): ResumePdfExporter {
  return lazyExporter(async () => fonts)
}

/** An exporter that loads the bundled font registry on first render. */
export function createBundledFontPdfExporter(): ResumePdfExporter {
  return lazyExporter(() => loadBundledFontRegistry())
}

function lazyExporter(loadFonts: () => Promise<FontRegistry>): ResumePdfExporter {
  let renderer: Promise<ResumePdfExporter> | null = null
  return {
    async render(input) {
      renderer ??= (async () => {
        const fonts = await loadFonts()
        const { ReactPdfResumeExporter } = await import('./ReactPdfResumeExporter')
        return new ReactPdfResumeExporter(fonts)
      })()
      try {
        return await (await renderer).render(input)
      } catch (failure) {
        // A first render that failed must not make every later export fail with
        // the same stale promise.
        renderer = null
        throw failure
      }
    },
  }
}
