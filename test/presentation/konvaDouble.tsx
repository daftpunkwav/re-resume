/**
 * @file konvaDouble
 * @description A react-konva stand-in that draws nothing.
 *
 * Konva needs a real 2d canvas context, which jsdom does not provide. This
 * module replaces the node tree with DOM elements that carry the geometry as
 * data attributes and forward the Konva handlers the canvas attaches, so a
 * test can assert the contract between the canvas and the drawing engine: which
 * lines are drawn, where, and when a drag is reported.
 *
 * A dragged node follows the pointer the way Konva moves it, and a call to
 * position() is recorded so a test can see the canvas putting the node back
 * before it waits for the commit.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'

const MEASURED_FIELDS = [
  'x',
  'y',
  'width',
  'height',
  'draggable',
  'listening',
  'text',
  'fontSize',
  'fontFamily',
  'fontStyle',
  'wrap',
  'fill',
  'opacity',
] as const

// dbltap is Konva's touch counterpart of dblclick; a DOM dblclick never fires
// it, so tests exercise the mouse path and the tap path stays wiring-identical.
const FORWARDED_EVENTS = [
  'onClick',
  'onTap',
  'onDblClick',
  'onDblTap',
  'onDragStart',
  'onDragMove',
  'onDragEnd',
] as const

interface Pointer {
  readonly x: number
  readonly y: number
}

export interface RecordedPosition {
  readonly nodeId: string
  readonly x: number
  readonly y: number
}

export const konvaNodePositions: RecordedPosition[] = []

export function resetKonvaNodePositions(): void {
  konvaNodePositions.length = 0
}

interface KonvaDoubleProps {
  readonly children?: ReactNode
  readonly [key: string]: unknown
}

function kebab(field: string): string {
  return field.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)
}

function measuredAttributes(props: KonvaDoubleProps): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const field of MEASURED_FIELDS) {
    const value = props[field]
    if (value === undefined || value === null) continue
    attributes[`data-${kebab(field)}`] = String(value)
  }
  return attributes
}

function pointerOf(domEvent: object, fallback: Pointer): Pointer {
  // clientX/clientY are what Konva converts into the node's new position.
  const candidate = domEvent as { clientX?: number; clientY?: number }
  return {
    x: typeof candidate.clientX === 'number' ? candidate.clientX : fallback.x,
    y: typeof candidate.clientY === 'number' ? candidate.clientY : fallback.y,
  }
}

export function Stage(props: KonvaDoubleProps) {
  return (
    <div data-konva="stage" {...measuredAttributes(props)}>
      {props.children}
    </div>
  )
}

export function Layer(props: KonvaDoubleProps) {
  return (
    <div data-konva="layer" {...measuredAttributes(props)}>
      {props.children}
    </div>
  )
}

export function Group(props: KonvaDoubleProps) {
  return (
    <div data-konva="group" {...measuredAttributes(props)}>
      {props.children}
    </div>
  )
}

export function Rect(props: KonvaDoubleProps) {
  const nodeId = props.name === undefined ? '' : String(props.name)
  const elementRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  }, [props])
  const pointer = useRef<Pointer>({ x: Number(props.x ?? 0), y: Number(props.y ?? 0) })
  const node = useRef({
    x: () => pointer.current.x,
    y: () => pointer.current.y,
    position: (next: Pointer) => {
      konvaNodePositions.push({ nodeId: String(latest.current.name ?? ''), x: next.x, y: next.y })
      pointer.current = next
    },
  })

  // Konva subscribes to its own events on the node rather than through React's
  // synthetic system, which has no dragmove at all. The double does the same,
  // which is why a test can fire a drag the component would really receive.
  // Whether a node can be dragged is decided here, at mount, so the effect has
  // to run again when the canvas takes a document read-only or writable.
  // A layout effect, because Konva binds when a node enters the tree, not a
  // tick later: a passive effect would leave a window where the node is in the
  // DOM but a click fired at it reaches no one.
  useLayoutEffect(() => {
    const element = elementRef.current
    if (element === null) return
    const attached: [string, EventListener][] = []
    for (const name of FORWARDED_EVENTS) {
      // Konva only drags a node that is draggable; a read-only document never
      // emits a drag at all, and the double must not invent one.
      if (name.startsWith('onDrag') && props.draggable !== true) continue
      const type = name.slice(2).toLowerCase()
      const listener: EventListener = (domEvent) => {
        const current = latest.current[name]
        if (typeof current !== 'function') return
        pointer.current = pointerOf(domEvent, pointer.current)
        current({ ...(domEvent as object), target: node.current })
      }
      element.addEventListener(type, listener)
      attached.push([type, listener])
    }
    return () => {
      for (const [type, listener] of attached) element.removeEventListener(type, listener)
    }
  }, [props.draggable])

  return (
    <div ref={elementRef} data-konva="rect" data-node-id={nodeId} {...measuredAttributes(props)} />
  )
}

export function Text(props: KonvaDoubleProps) {
  return (
    <div data-konva="text" {...measuredAttributes(props)}>
      {String(props.text ?? '')}
    </div>
  )
}
