/**
 * @file ResizeHandle
 * @description The draggable edge between the conversation and the panel dock.
 * A pointer drag writes the width custom property directly on the shell, so
 * the dock follows the pointer without a React render per frame; the settled
 * width is committed once, when the pointer is released.
 *
 * Responsibilities:
 * - Track the pointer 1:1, clamped to the legal range
 * - Support the keyboard: arrow keys move by a fixed step, Home/End go to the
 *   ends, and the value is announced through the separator role
 *
 * Constraints:
 * - The right edge of the window is the dock's right edge, so dragging left
 *   makes the dock wider.
 */

import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { clampPanelWidth, PANEL_WIDTH_DEFAULT } from '../../domain/settings/AppSettings'

/** Pixels one arrow-key press moves the edge. */
export const RESIZE_KEYBOARD_STEP = 16

export interface ResizeHandleProps {
  readonly width: number
  readonly minimum: number
  readonly maximum: number
  /** Called once with the settled width. */
  readonly onCommit: (width: number) => void
}

interface DragState {
  readonly pointerId: number
  readonly startX: number
  readonly startWidth: number
  readonly shell: HTMLElement | null
  current: number
}

export function ResizeHandle({ width, minimum, maximum, onCommit }: ResizeHandleProps) {
  const drag = useRef<DragState | null>(null)

  const clamp = (value: number): number =>
    Math.min(maximum, Math.max(minimum, clampPanelWidth(value, maximum)))

  const preview = (value: number): void => {
    drag.current?.shell?.style.setProperty('--panel-right-width', `${value}px`)
  }

  const finish = (commit: boolean): void => {
    const state = drag.current
    if (state === null) return
    drag.current = null
    state.shell?.removeAttribute('data-resizing')
    if (commit && state.current !== width) onCommit(state.current)
    else state.shell?.style.removeProperty('--panel-right-width')
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const shell = event.currentTarget.closest<HTMLElement>('.shell')
    event.currentTarget.setPointerCapture(event.pointerId)
    shell?.setAttribute('data-resizing', 'true')
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      shell,
      current: width,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (state === null || state.pointerId !== event.pointerId) return
    const next = clamp(state.startWidth - (event.clientX - state.startX))
    state.current = next
    preview(next)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (state === null || state.pointerId !== event.pointerId) return
    finish(true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? RESIZE_KEYBOARD_STEP * 4 : RESIZE_KEYBOARD_STEP
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onCommit(clamp(width + step))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      onCommit(clamp(width - step))
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onCommit(minimum)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      onCommit(maximum)
    }
  }

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整面板宽度"
      aria-valuenow={width}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      tabIndex={0}
      title="拖动调整宽度，双击复位"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => finish(false)}
      onDoubleClick={() => onCommit(clampPanelWidth(PANEL_WIDTH_DEFAULT, maximum))}
      onKeyDown={onKeyDown}
    >
      <span className="resize-handle-line" aria-hidden="true" />
    </div>
  )
}
