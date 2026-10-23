/**
 * @file CanvasTextMeasurer
 * @description Caret positioning and hit-testing during canvas text editing.
 *
 * This measurer is AUXILIARY ONLY and must never feed layout(). Rendering
 * draws the lines layout() precomputed, so if the engine's own measureText
 * could change a line break or a page count, the same document would paginate
 * differently depending on which machine drew it. Layout, pagination and
 * overflow checks all use the canonical fontkit measurer; the divergence
 * between the two — caret placement error — is listed in spec section 11.
 *
 * Constraints:
 * - The caller owns the canvas transform. fontSize is in points, while the
 *   canvas font shorthand only accepts pixels, so the number is carried across
 *   unchanged and the canvas scale factor does the rest.
 * - ctx.font is restored after every measurement: the measurer shares one
 *   context with the renderer, and leaving a font behind would make the next
 *   draw silently use this measurer's face.
 */

import type { TextMeasurer, TextRun } from '../../domain/resume/ports/TextMeasurer'
import type { TextStyle } from '../../domain/resume/TextStyle'

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

export function createCanvasTextMeasurer(ctx: CanvasRenderingContext2D): TextMeasurer {
  return {
    measureLine: (text: string, style: TextStyle): number =>
      withStyle(ctx, style, () => ctx.measureText(text).width),

    // Cumulative prefix widths rather than per-cluster sums: a canvas
    // measures a string, not a glyph, so this is the only way to get the
    // advance a prefix actually occupies — kerning included.
    measureClusters: (text: string, style: TextStyle): readonly number[] => {
      const clusters = [...graphemeSegmenter.segment(text)].map((entry) => entry.segment)
      const cumulative: number[] = []
      withStyle(ctx, style, () => {
        let prefix = ''
        for (const cluster of clusters) {
          prefix += cluster
          cumulative.push(ctx.measureText(prefix).width)
        }
      })
      return cumulative
    },

    // One run for the whole text: the canvas resolves a family by name and
    // picks the face itself, so it has no character maps to decide coverage
    // with. The run is therefore the whole line, drawn with the family the
    // style names.
    resolveRuns: (text: string, style: TextStyle): readonly TextRun[] => [
      {
        text,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        width: withStyle(ctx, style, () => ctx.measureText(text).width),
        baselineShift: 0,
      },
    ],
  }
}

function withStyle<T>(ctx: CanvasRenderingContext2D, style: TextStyle, measure: () => T): T {
  const previousFont = ctx.font
  ctx.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`
  try {
    return measure()
  } finally {
    ctx.font = previousFont
  }
}
