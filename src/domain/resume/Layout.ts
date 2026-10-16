/**
 * @file Layout
 * @description How a block is placed on the page. Kept out of BlockContent so
 * content semantics never depend on a coordinate.
 */

export type BlockLayout = FlowLayout | AbsoluteLayout

/** Position is determined by surrounding content. The default. */
export interface FlowLayout {
  readonly mode: 'flow'
  readonly columnSpan: 1 | 2
}

/** Position is set explicitly by the user on the canvas. */
export interface AbsoluteLayout {
  readonly mode: 'absolute'
  /** Unit: points (1/72 inch), origin at the page's top-left. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly zIndex: number
  readonly rotation: number
}

export const DEFAULT_FLOW_LAYOUT: FlowLayout = { mode: 'flow', columnSpan: 1 }

export function isFlowLayout(layout: BlockLayout): layout is FlowLayout {
  return layout.mode === 'flow'
}

export function isAbsoluteLayout(layout: BlockLayout): layout is AbsoluteLayout {
  return layout.mode === 'absolute'
}
