/**
 * @file BundledFontRegistry
 * @description Loads the font files shipped in the application bundle into the
 * FontRegistry the canonical measurer and the exporters consume. The registry
 * is keyed by the domain's default font family, so a document styled with the
 * default measures against exactly these bytes on both platforms.
 *
 * Constraints:
 * - A failed load throws: without the bundled faces nothing can measure or
 *   draw faithfully, and a silent fallback would move line breaks.
 * - Font bytes are fetched over the bundle origin (dev server or tauri asset
 *   protocol), which the content security policy already allows.
 */

import { DEFAULT_FONT_FAMILY } from '../../domain/resume/TextStyle'
import type { FontFamily, FontRegistry } from './FontRegistry'
import regularFontUrl from '../../assets/fonts/NotoSansSC-Regular.otf?url'
import boldFontUrl from '../../assets/fonts/NotoSansSC-Bold.otf?url'
import symbolsFontUrl from '../../assets/fonts/NotoSansSymbols2-Regular.otf?url'

/**
 * The family the characters the default family lacks are covered by. It is a
 * family of its own rather than a second face of the default one, so a
 * renderer can register it and draw a run with it under its own name.
 */
export const SYMBOL_FONT_FAMILY = 'Noto Sans Symbols 2'

export async function loadBundledFontRegistry(): Promise<FontRegistry> {
  // The three reads are independent, and they sit on the boot path in front of
  // the first paint, so they run in parallel.
  const [regular, bold, symbols] = await Promise.all([
    fetchFontBytes(regularFontUrl),
    fetchFontBytes(boldFontUrl),
    fetchFontBytes(symbolsFontUrl),
  ])
  const families = new Map<string, FontFamily>([
    [
      DEFAULT_FONT_FAMILY,
      { faces: { regular, bold }, fallbackFamily: SYMBOL_FONT_FAMILY },
    ],
    [SYMBOL_FONT_FAMILY, { faces: { regular: symbols, bold: null }, fallbackFamily: null }],
  ])
  return families
}

async function fetchFontBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`The bundled font request failed with ${response.status}: ${url}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
