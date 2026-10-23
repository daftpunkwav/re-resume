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
 * - Report the runs a text resolves to, so a renderer draws every stretch of
 *   it with the face it was measured with
 *
 * Constraints:
 * - Every family a document references must be in the registry; a missing one
 *   throws instead of silently falling back, because a substituted face would
 *   move line breaks away from what the exporters draw.
 * - measureClusters distributes shaped advances back onto grapheme clusters
 *   (a ligature's advance lands on its first cluster, combining marks land on
 *   their base), so prefix sums stay correct for caret alignment even where
 *   glyph and cluster boundaries disagree.
 * - A text is measured run by run, each run with the face that covers it: a
 *   family covers different characters, and measuring the whole text with one
 *   face would charge a character the .notdef advance of a face that cannot
 *   draw it.
 */

import type { Font } from 'fontkit'
import type { TextMeasurer, TextRun } from '../../domain/resume/ports/TextMeasurer'
import type { TextStyle } from '../../domain/resume/TextStyle'
import { FontFaceResolver } from './FontFaceResolver'
import type { FontRegistry } from './FontRegistry'

export function createFontkitTextMeasurer(fonts: FontRegistry): TextMeasurer {
  const resolver = new FontFaceResolver(fonts)
  return {
    measureLine: (text: string, style: TextStyle): number => {
      let total = 0
      for (const run of resolver.resolve(text, style)) {
        total += advanceOf(run.face, run.text) * (style.fontSize / run.face.unitsPerEm)
      }
      return total
    },

    measureClusters: (text: string, style: TextStyle): readonly number[] => {
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
      for (const run of resolver.resolve(text, style)) {
        // Each run is scaled by its own face: two faces of the same family can
        // declare different em sizes.
        const scale = style.fontSize / run.face.unitsPerEm
        const layout = run.face.layout(run.text)
        layout.glyphs.forEach((glyph, glyphIndex) => {
          const owner = clusterOfCodePoint[Math.min(codePointCursor, clusterOfCodePoint.length - 1)]!
          advances[owner] =
            (advances[owner] ?? 0) + layout.positions[glyphIndex]!.xAdvance * scale
          codePointCursor += glyph.codePoints.length
        })
      }
      return advances
    },

    resolveRuns: (text: string, style: TextStyle): readonly TextRun[] => {
      const primary = resolver.primary(style)
      return resolver.resolve(text, style).map((run) => ({
        text: run.text,
        fontFamily: run.family,
        fontWeight: run.weight,
        width: advanceOf(run.face, run.text) * (style.fontSize / run.face.unitsPerEm),
        // A face with taller metrics puts its baseline lower, so the run is
        // lifted by the difference. The shift is measured against the face the
        // document named, which is the face the rest of the line is drawn with.
        baselineShift:
          (baselineOffset(run.face) - baselineOffset(primary.face)) * style.fontSize,
      }))
    },
  }
}

/** The shaped advance of a text in one face, in font units. */
function advanceOf(face: Font, text: string): number {
  return face.layout(text).advanceWidth
}

/**
 * How far a face's baseline sits below the middle of its em box, in em. Two
 * faces with different metrics draw the same text at different heights, and
 * the difference is what puts a fallback run back onto the line's baseline.
 *
 * The descent counts as a negative number here, as fontkit reports it, while
 * the drawing engine counts it as a positive distance below the baseline: the
 * offset is therefore the sum of the two, not their difference.
 */
function baselineOffset(face: Font): number {
  return (face.ascent + face.descent) / 2 / face.unitsPerEm
}

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
