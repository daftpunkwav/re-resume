/**
 * @file TextEditorOverlay
 * @description In-place text editing for one canvas block.
 *
 * Konva draws text but cannot edit it, so the overlay is a textarea positioned
 * over the block's drawn box. The transform arrives in screen pixels — the same
 * projection the canvas drew with — so canvas zoom is reflected in the editor's
 * position and font size without this component knowing that a zoom exists.
 *
 * Constraints:
 * - It must not measure text and must not touch the document. The textarea is
 *   a plain editing surface: the canvas hides the drawn lines underneath it,
 *   and the committed text becomes a DocumentChange in the editor, not here.
 * - A blur commits and Escape cancels. Escape also blurs, so cancellation wins
 *   through a flag rather than racing the blur into a second outcome.
 */

import { useEffect, useRef, useState } from 'react'

export interface TextEditorOverlayProps {
  readonly initialText: string
  /** Screen-pixel placement of the block's drawn box. */
  readonly transform: { x: number; y: number; scale: number; width: number; height: number }
  /** Screen-pixel text metrics, taken from the laid-out style times the zoom. */
  readonly fontSize: number
  readonly lineHeight: number
  readonly fontFamily: string
  readonly onCommit: (text: string) => void
  readonly onCancel: () => void
}

export function TextEditorOverlay({
  initialText,
  transform,
  fontSize,
  lineHeight,
  fontFamily,
  onCommit,
  onCancel,
}: TextEditorOverlayProps) {
  const [text, setText] = useState(initialText)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  // Escape cancels the session; the blur it triggers must not also commit.
  const cancelled = useRef(false)

  useEffect(() => {
    areaRef.current?.focus()
  }, [])

  return (
    <textarea
      ref={areaRef}
      className="canvas-text-editor"
      aria-label="编辑区块文字"
      value={text}
      onChange={(event) => setText(event.target.value)}
      style={{
        left: transform.x,
        top: transform.y,
        width: Math.max(transform.width, 1),
        height: Math.max(transform.height, lineHeight),
        fontSize,
        lineHeight: `${lineHeight}px`,
        fontFamily,
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        cancelled.current = true
        onCancel()
      }}
      onBlur={() => {
        if (cancelled.current) return
        onCommit(text)
      }}
    />
  )
}
