/**
 * @file TextMeasurer
 * @description Width measurement for a styled string. A port rather than an
 * application service: layout data and ToolContext reference it, and the
 * fontkit implementation lives in infrastructure.
 */

import type { TextStyle } from '../TextStyle'

/**
 * A stretch of a line that one family covers. A renderer draws every run with
 * the family it names, so the drawn glyph and the measured advance come from
 * the same face.
 */
export interface TextRun {
  readonly text: string
  /** The family that covers this run. */
  readonly fontFamily: string
  /** The weight of the face that covers this run: 400 or 700. */
  readonly fontWeight: number
  /** The run's advance width, in points. */
  readonly width: number
  /**
   * How far the run's baseline sits below the line's baseline, in points. A
   * face with taller metrics draws its text lower, and the shift lifts it back
   * onto the line.
   */
  readonly baselineShift: number
}

export interface TextMeasurer {
  /** Returns the advance width of a single line. */
  measureLine(text: string, style: TextStyle): number
  /** Advance width per grapheme cluster; basis for mixed-script alignment. */
  measureClusters(text: string, style: TextStyle): readonly number[]
  /**
   * The runs the text resolves to. The runs cover the text in order and their
   * widths add up to the line width.
   */
  resolveRuns(text: string, style: TextStyle): readonly TextRun[]
}
