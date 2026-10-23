/**
 * @file FontRegistry
 * @description The shapes the font infrastructure shares: the faces of every
 * family the application measures and draws with, and the family each of them
 * falls back to for the characters its own faces do not cover.
 *
 * Constraints:
 * - The registry is the only place a family name is bound to bytes. The
 *   measurer resolves a name to faces, the canvas registers the same bytes
 *   under the same name, and the document names the family it wants.
 * - A fallback is named rather than nested, so a renderer can register it and
 *   draw a run with it under the very name the measurer resolved it to.
 */

/**
 * The faces one family resolves to. A family without a bold face declares null
 * and every weight resolves to the regular face. The bytes are typed as views
 * over a concrete ArrayBuffer because that is what the FontFace constructor
 * requires and what the asset fetch produces.
 */
export interface FontFaces {
  readonly regular: Uint8Array<ArrayBuffer>
  readonly bold: Uint8Array<ArrayBuffer> | null
}

/**
 * A family the registry carries: its own faces, and the family that covers the
 * characters those faces lack.
 */
export interface FontFamily {
  readonly faces: FontFaces
  /**
   * The family whose faces cover the characters this family's faces lack, or
   * null when the family ends the chain. A character no family in the chain
   * covers stays with the family the document named: both sides then measure
   * and draw its .notdef.
   */
  readonly fallbackFamily: string | null
}

/**
 * Maps a document fontFamily to what the application knows about it.
 */
export type FontRegistry = ReadonlyMap<string, FontFamily>

/**
 * Thrown when a document references a family the registry does not carry.
 * Surfaces at the first measure call; the message names the family and the
 * families that are available so the cause is diagnosable from the log.
 */
export class MissingFontFamilyError extends Error {
  readonly fontFamily: string

  constructor(fontFamily: string, availableFamilies: readonly string[]) {
    super(
      `Font family "${fontFamily}" is not registered. Available families: ` +
        (availableFamilies.length === 0 ? '(none)' : availableFamilies.join(', ')),
    )
    this.name = 'MissingFontFamilyError'
    this.fontFamily = fontFamily
  }
}
