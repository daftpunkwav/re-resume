/**
 * @file TextMeasurer
 * @description Width measurement for a styled string. A port rather than an
 * application service: layout data and ToolContext reference it, and the
 * fontkit implementation lives in infrastructure.
 */

import type { TextStyle } from '../TextStyle'

export interface TextMeasurer {
  /** Returns the advance width of a single line. */
  measureLine(text: string, style: TextStyle): number
  /** Advance width per grapheme cluster; basis for mixed-script alignment. */
  measureClusters(text: string, style: TextStyle): readonly number[]
}
