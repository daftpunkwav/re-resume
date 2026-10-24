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
 * - The families form a chain: the default family falls back to the symbol
 *   family, and that one to the emoji family. A character is measured and
 *   drawn with the first face of the chain whose character map covers it.
 */

import { DEFAULT_FONT_FAMILY } from '../../domain/resume/TextStyle'
import type { FontFamily, FontRegistry } from './FontRegistry'
import regularFontUrl from '../../assets/fonts/NotoSansSC-Regular.otf?url'
import boldFontUrl from '../../assets/fonts/NotoSansSC-Bold.otf?url'
import symbolsFontUrl from '../../assets/fonts/NotoSansSymbols2-Regular.otf?url'
import emojiFontUrl from '../../assets/fonts/NotoEmoji-Variable.ttf?url'

/**
 * The family the characters the default family lacks are covered by. It is a
 * family of its own rather than a second face of the default one, so a
 * renderer can register it and draw a run with it under its own name.
 */
export const SYMBOL_FONT_FAMILY = 'Noto Sans Symbols 2'

/**
 * The family the characters the symbol family lacks are covered by. The emoji
 * presentation sequences are in neither the default family nor the symbol
 * family, so without this face the measurer charges them the .notdef advance
 * of the family the document named, while the drawing engine substitutes a
 * system emoji face for them — and the two widths differ.
 *
 * The face is a monochrome face: it carries the glyph outlines and no colour,
 * so a renderer that cannot draw colour fonts can still draw the emoji.
 *
 * It is a variable font, and only its default instance is used. The measurer
 * reads the outlines of that instance, so the drawing engine has to pick the
 * same one, which is why this family declares no bold face: a bold face would
 * make the engine draw the bold instance of a bold run, while the measurer
 * would still measure the default one. Every weight therefore resolves to the
 * regular face, and the engine is asked for weight 400.
 */
export const EMOJI_FONT_FAMILY = 'Noto Emoji'

export async function loadBundledFontRegistry(): Promise<FontRegistry> {
  // The four reads are independent, and they sit on the boot path in front of
  // the first paint, so they run in parallel.
  const [regular, bold, symbols, emoji] = await Promise.all([
    fetchFontBytes(regularFontUrl),
    fetchFontBytes(boldFontUrl),
    fetchFontBytes(symbolsFontUrl),
    fetchFontBytes(emojiFontUrl),
  ])
  const families = new Map<string, FontFamily>([
    [
      DEFAULT_FONT_FAMILY,
      { faces: { regular, bold }, fallbackFamily: SYMBOL_FONT_FAMILY },
    ],
    [
      SYMBOL_FONT_FAMILY,
      { faces: { regular: symbols, bold: null }, fallbackFamily: EMOJI_FONT_FAMILY },
    ],
    [EMOJI_FONT_FAMILY, { faces: { regular: emoji, bold: null }, fallbackFamily: null }],
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
