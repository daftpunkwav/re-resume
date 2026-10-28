/**
 * @file ResumePageParts
 * @description The non-content parts of one paper sheet: its drop shadow, the
 * paper itself with the background click target, and the page number.
 */

import { Rect, Text as KonvaText } from 'react-konva'

import type { PageScreenBox } from './canvasProjection'
import { PAPER_FILL, fontFamilyOf } from './canvasStyle'

export function PaperShadow({ box }: { readonly box: PageScreenBox }) {
  return (
    <Rect
      x={box.left + 2}
      y={box.top + 4}
      width={box.width}
      height={box.height}
      fill="#000000"
      opacity={0.12}
      shadowColor="#0f172a"
      shadowBlur={18}
      shadowOpacity={0.22}
      shadowOffsetY={6}
      listening={false}
    />
  )
}

export function PaperSurface({
  box,
  onBackground,
}: {
  readonly box: PageScreenBox
  readonly onBackground: () => void
}) {
  return (
    <Rect
      x={box.left}
      y={box.top}
      width={box.width}
      height={box.height}
      fill={PAPER_FILL}
      stroke="#d5dae1"
      strokeWidth={1}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBackground()
      }}
      onTap={(event) => {
        if (event.target === event.currentTarget) onBackground()
      }}
    />
  )
}

export function PageNumberText({
  box,
  pageIndex,
  pageCount,
  zoom,
}: {
  readonly box: PageScreenBox
  readonly pageIndex: number
  readonly pageCount: number
  readonly zoom: number
}) {
  return (
    <KonvaText
      x={box.left}
      y={box.top + box.height - 26 * zoom}
      width={box.width}
      align="center"
      text={`第 ${(pageIndex + 1).toString()} 页 / 共 ${pageCount.toString()} 页`}
      fontSize={8.5 * zoom}
      fontFamily={fontFamilyOf('Noto Sans SC')}
      fill="#606770"
      listening={false}
    />
  )
}
