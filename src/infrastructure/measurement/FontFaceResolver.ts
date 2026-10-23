/**
 * @file FontFaceResolver
 * @description Decides which face covers which characters, and with that the
 * face every stretch of a text is measured and drawn with. A document's family
 * covers most of its text; the characters it lacks are covered by the family
 * it falls back to. The resolver splits a text into the runs one family covers
 * each, so the measurer and the renderer can name the same face for the same
 * characters.
 *
 * Responsibilities:
 * - Parse the registry's faces once and keep them
 * - Resolve a text into runs, each with the family and the face that covers it
 *
 * Constraints:
 * - The decision is made by what the character maps cover, not by the family
 *   name: a family that lacks a character hands it to the family it falls back
 *   to, and a character no family in the chain covers stays with the family
 *   the document named, whose .notdef both sides then agree on.
 * - A face is picked per weight the way CSS font matching picks it: the bold
 *   face above the five-hundred boundary, the regular face otherwise. A family
 *   without a bold face resolves every weight to its regular face.
 */

import { create as createFontkitFont } from 'fontkit'
import type { Font } from 'fontkit'
import type { TextStyle } from '../../domain/resume/TextStyle'
import { MissingFontFamilyError } from './FontRegistry'
import type { FontFamily, FontRegistry } from './FontRegistry'

/**
 * A weight above this resolves to the bold face. The boundary follows CSS font
 * matching for a 400/700 pair — weights up to 500 fall back to the regular
 * face, anything above reaches the 700 face — so the canvas picking a face by
 * CSS rules and the measurer picking one here never disagree.
 */
const BOLD_WEIGHT_THRESHOLD = 500

/** The regular and the bold face of one family, parsed. */
interface ParsedFamily {
  readonly regular: Font
  readonly bold: Font | null
}

/** The face that covers one stretch of text. */
export interface FaceCover {
  /** The family the face belongs to. A renderer draws the run with it. */
  readonly family: string
  /** The weight of the face: 400 for the regular face, 700 for the bold one. */
  readonly weight: number
  readonly face: Font
}

/** A stretch of text that one face covers. */
export interface FaceRun extends FaceCover {
  readonly text: string
}

export class FontFaceResolver {
  readonly #registry: FontRegistry
  readonly #parsed = new Map<string, ParsedFamily>()

  constructor(registry: FontRegistry) {
    this.#registry = registry
  }

  /**
   * The runs a text resolves to. A run ends where the face that covers the
   * next character changes, so the runs of one text cover it in order.
   */
  resolve(text: string, style: TextStyle): readonly FaceRun[] {
    const runs: FaceRun[] = []
    let open: { family: string; weight: number; face: Font; text: string } | null = null
    for (const { segment } of graphemeSegmenter.segment(text)) {
      const cover = this.#coverOf(segment, style)
      if (open === null || open.family !== cover.family || open.face !== cover.face) {
        if (open !== null) runs.push(open)
        open = { family: cover.family, weight: cover.weight, face: cover.face, text: segment }
        continue
      }
      open.text += segment
    }
    if (open !== null) runs.push(open)
    return runs
  }

  /**
   * The face the style itself resolves to: the family the document named, with
   * the face that weight asks for. It is the face every other run of that
   * document is measured against.
   */
  primary(style: TextStyle): FaceCover {
    return this.#coverOfFamily(style.fontFamily, style)
  }

  /**
   * The face that covers one cluster: the family's own face when its
   * character map has the character, the fallback family's face when it does
   * not, and the document's own face when no family in the chain has it.
   */
  #coverOf(cluster: string, style: TextStyle): FaceCover {
    const codePoint = cluster.codePointAt(0)
    if (codePoint === undefined) return this.#coverOfFamily(style.fontFamily, style)
    const visited = new Set<string>()
    let familyName: string | null = style.fontFamily
    while (familyName !== null && !visited.has(familyName)) {
      visited.add(familyName)
      const cover = this.#coverOfFamily(familyName, style)
      if (cover.face.hasGlyphForCodePoint(codePoint)) return cover
      familyName = this.#family(familyName).fallbackFamily
    }
    // No family in the chain covers the character. It stays with the family
    // the document named, so the measurer and the renderer agree on its
    // .notdef instead of one of them reaching for a system face.
    return this.#coverOfFamily(style.fontFamily, style)
  }

  #coverOfFamily(familyName: string, style: TextStyle): FaceCover {
    const parsed = this.#parsedFace(familyName)
    const bold = style.fontWeight > BOLD_WEIGHT_THRESHOLD && parsed.bold !== null
    return {
      family: familyName,
      weight: bold ? 700 : 400,
      face: bold ? parsed.bold : parsed.regular,
    }
  }

  #parsedFace(familyName: string): ParsedFamily {
    const existing = this.#parsed.get(familyName)
    if (existing !== undefined) return existing
    const family = this.#family(familyName)
    const parsed: ParsedFamily = {
      regular: parseFace(family.faces.regular, familyName, 'regular'),
      bold: family.faces.bold === null ? null : parseFace(family.faces.bold, familyName, 'bold'),
    }
    this.#parsed.set(familyName, parsed)
    return parsed
  }

  #family(familyName: string): FontFamily {
    const family = this.#registry.get(familyName)
    if (family === undefined) {
      throw new MissingFontFamilyError(familyName, [...this.#registry.keys()])
    }
    return family
  }
}

/**
 * Parses one face and refuses a collection: the bundled files each carry a
 * single face, so a collection here means the wrong file shipped, and picking
 * a member silently would embed that guess in every measured line.
 */
function parseFace(bytes: Uint8Array<ArrayBuffer>, family: string, role: string): Font {
  // fontkit's types name Buffer, but its browser build consumes plain
  // Uint8Array, so the registry's bytes narrow to Buffer only at this boundary.
  const parsed = createFontkitFont(bytes as Buffer)
  if ('fonts' in parsed) {
    throw new Error(
      `The ${role} face of "${family}" resolved to a font collection; a single face is required`,
    )
  }
  return parsed
}

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
