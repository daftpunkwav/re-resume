/**
 * @file FixtureTextMeasurer
 * @description Deterministic TextMeasurer for tests. Widths come from a fixed
 * table rather than font metrics, so pagination and line-breaking tests assert
 * exact page counts without a browser, a font file or a running exporter — and
 * without every test double reimplementing the production measurement rules,
 * which is how a measurer and its tests end up wrong together and still green.
 *
 * Constraints:
 * - Widths are declared in em units and multiplied by the style's font size, so
 *   a style change is visible in the result but font family and weight are not:
 *   this measurer has one table, not a font.
 * - CJK clusters are twice as wide as Latin ones, which is what makes mixed
 *   script a real case here: a line of Han text wraps roughly twice as fast as
 *   a line of Latin text of the same character count.
 */

import type { TextMeasurer } from '../../domain/resume/ports/TextMeasurer'
import type { TextStyle } from '../../domain/resume/TextStyle'

/** Advance widths in em units. */
export const FIXTURE_CLUSTER_WIDTHS = {
  /** Spaces and tabs: narrower than a letter, wider than nothing. */
  blank: 0.5,
  latin: 1,
  /** Han, Kana, Hangul and the fullwidth forms. */
  wide: 2,
} as const

export type FixtureClusterWidth = (typeof FIXTURE_CLUSTER_WIDTHS)[keyof typeof FIXTURE_CLUSTER_WIDTHS]

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

export class FixtureTextMeasurer implements TextMeasurer {
  readonly #widths: Readonly<Record<string, number>>

  constructor(widths: Readonly<Record<string, number>> = FIXTURE_CLUSTER_WIDTHS) {
    this.#widths = widths
  }

  measureLine(text: string, style: TextStyle): number {
    let total = 0
    for (const cluster of graphemeSegmenter.segment(text)) {
      total += this.#widths[widthClassOf(cluster.segment)] ?? this.#widths.latin ?? 0
    }
    return total * style.fontSize
  }

  measureClusters(text: string, style: TextStyle): readonly number[] {
    const widths: number[] = []
    for (const cluster of graphemeSegmenter.segment(text)) {
      widths.push((this.#widths[widthClassOf(cluster.segment)] ?? this.#widths.latin ?? 0) * style.fontSize)
    }
    return widths
  }
}

/**
 * A combining mark is part of the cluster before it, so it must not widen the
 * cluster; everything else falls through to the width table.
 */
function widthClassOf(cluster: string): string {
  if (cluster === ' ' || cluster === '\t' || cluster === '\n') return 'blank'
  if (cluster.length === 1 && COMBINING_MARKS.test(cluster)) return 'blank'
  return isWideCluster(cluster) ? 'wide' : 'latin'
}

/** Hangul Jamo, CJK radicals through Yi, Hiragana and Katakana, Hangul
 *  syllables, CJK extensions, ideograph compatibility forms, fullwidth forms,
 *  and the supplementary ideographic planes. */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
]

const COMBINING_MARKS = /^\p{Mn}$/u

function isWideCluster(cluster: string): boolean {
  const codePoint = cluster.codePointAt(0)
  if (codePoint === undefined) return false
  return WIDE_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high)
}
