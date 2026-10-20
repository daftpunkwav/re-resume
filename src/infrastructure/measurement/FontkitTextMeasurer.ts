/**
 * @file FontkitTextMeasurer
 * @description The canonical TextMeasurer: platform-independent, backed by
 * fontkit — the same shaping library the PDF exporter will draw with. All
 * pagination, line breaking and overflow checks run through it on both
 * platforms, so export results cannot diverge between Chromium and WebKit.
 *
 * Responsibilities:
 * - Resolve a style's fontFamily to parsed faces and pick one by weight
 * - Return shaped advance widths in points for lines and grapheme clusters
 *
 * Constraints:
 * - Every family a document references must be in the registry; a missing one
 *   throws instead of silently falling back, because a substituted face would
 *   move line breaks away from what the exporters draw.
 * - measureClusters distributes shaped advances back onto grapheme clusters
 *   (a ligature's advance lands on its first cluster, combining marks land on
 *   their base), so prefix sums stay correct for caret alignment even where
 *   glyph and cluster boundaries disagree.
 */

import { create as createFontkitFont } from 'fontkit'
import type { Font } from 'fontkit'
import type { TextMeasurer } from '../../domain/resume/ports/TextMeasurer'
import type { TextStyle } from '../../domain/resume/TextStyle'

/**
 * The faces one document fontFamily resolves to. A family without a bundled
 * bold face declares null and every weight resolves to the regular face. The
 * bytes are typed as views over a concrete ArrayBuffer because that is what
 * the FontFace constructor requires and what the asset fetch produces.
 */
export interface FontFaces {
  readonly regular: Uint8Array<ArrayBuffer>
  readonly bold: Uint8Array<ArrayBuffer> | null
}

/**
 * Maps a document fontFamily to its font bytes. Carries both faces rather
 * than the spec's single `Uint8Array` per family because TextStyle carries a
 * fontWeight and the faces' advances differ measurably (~4% on Latin), so
 * measuring bold text with regular metrics would move line breaks away from
 * what any renderer drawing the bold face produces.
 */
export type FontRegistry = ReadonlyMap<string, FontFaces>

/** Weights from here up resolve to the bold face when one is registered. */
const BOLD_WEIGHT_THRESHOLD = 600

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

export function createFontkitTextMeasurer(fonts: FontRegistry): TextMeasurer {
  const facesByFamily = new Map<string, ResolvedFamily>()

  /** The parsed face a style's family and weight resolve to. */
  const faceFor = (style: TextStyle): Font => {
    const faces = fonts.get(style.fontFamily)
    if (faces === undefined) {
      throw new MissingFontFamilyError(style.fontFamily, [...fonts.keys()])
    }
    let resolved = facesByFamily.get(style.fontFamily)
    if (resolved === undefined) {
      // Parsed eagerly rather than per call: a corrupt face fails at the first
      // measure instead of hiding behind the memo. fontkit's types name Buffer,
      // but its browser build consumes plain Uint8Array, so the registry's
      // bytes narrow to Buffer only at this boundary.
      resolved = {
        regular: parseFace(faces.regular, style.fontFamily, 'regular'),
        bold: faces.bold === null ? null : parseFace(faces.bold, style.fontFamily, 'bold'),
      }
      facesByFamily.set(style.fontFamily, resolved)
    }
    return style.fontWeight >= BOLD_WEIGHT_THRESHOLD && resolved.bold !== null
      ? resolved.bold
      : resolved.regular
  }

  return {
    measureLine: (text: string, style: TextStyle): number => {
      const font = faceFor(style)
      return font.layout(text).advanceWidth * (style.fontSize / font.unitsPerEm)
    },

    measureClusters: (text: string, style: TextStyle): readonly number[] => {
      const font = faceFor(style)
      const run = font.layout(text)
      const scale = style.fontSize / font.unitsPerEm
      const clusters = [...graphemeSegmenter.segment(text)]
      // The cluster owning each code point of the source string, so a glyph
      // can be charged to the cluster its first code point belongs to.
      const clusterOfCodePoint: number[] = []
      clusters.forEach((cluster, clusterIndex) => {
        for (let i = 0; i < [...cluster.segment].length; i += 1) {
          clusterOfCodePoint.push(clusterIndex)
        }
      })
      const advances = new Array<number>(clusters.length).fill(0)
      let codePointCursor = 0
      let glyphIndex = 0
      for (const glyph of run.glyphs) {
        const owner = clusterOfCodePoint[Math.min(codePointCursor, clusterOfCodePoint.length - 1)]!
        advances[owner] = (advances[owner] ?? 0) + run.positions[glyphIndex]!.xAdvance
        codePointCursor += glyph.codePoints.length
        glyphIndex += 1
      }
      return advances.map((width) => width * scale)
    },
  }
}

interface ResolvedFamily {
  readonly regular: Font
  readonly bold: Font | null
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
