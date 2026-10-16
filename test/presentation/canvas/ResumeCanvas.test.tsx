/**
 * @file ResumeCanvas.test
 * @description What the canvas may assert about itself without a drawing
 * engine: the geometry it derives from a LayoutOutput, and the fact that one
 * drag becomes one drop intent.
 *
 * react-konva is replaced by konvaDouble, so no 2d canvas context is needed.
 * Painting itself — pixels, text rasterisation, Konva's own hit testing — is
 * not covered here and cannot be in jsdom.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_TEXT_STYLE } from '../../../src/domain/resume/TextStyle'
import { asBlockId } from '../../../src/domain/shared/branded-id'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ResumeCanvas,
  clampAbsolutePoint,
  contentPointFromSheet,
  describeOverflow,
  fitWidthZoom,
  projectLayoutToSheets,
  reorderIndexForDrop,
} from '../../../src/presentation/canvas/ResumeCanvas'
import type { LaidOutBlock } from '../../../src/domain/resume/PageLayout'
import { konvaNodePositions, resetKonvaNodePositions } from '../konvaDouble'
import { absoluteBlock, dividerBlock, layoutWithPages, textBlock } from '../resumeFixtures'
import { TestResizeObserver } from '../../setup'

vi.mock('react-konva', async () => {
  const double = await import('../konvaDouble')
  return {
    Stage: double.Stage,
    Layer: double.Layer,
    Group: double.Group,
    Rect: double.Rect,
    Text: double.Text,
  }
})

// React only exposes act() from its development build, and testing-library

const CONTENT_WIDTH = A4_PAGE_SETUP.pageWidth - A4_PAGE_SETUP.marginLeft - A4_PAGE_SETUP.marginRight

function laidOut(overrides: Partial<LaidOutBlock> & Pick<LaidOutBlock, 'blockId'>): LaidOutBlock {
  return {
    pageIndex: 0,
    x: 0,
    y: 0,
    width: CONTENT_WIDTH,
    height: 33,
    textStyle: DEFAULT_TEXT_STYLE,
    lines: [{ text: '甲', x: 0, width: 11 }],
    ...overrides,
  }
}

const TWO_LINE_BLOCK = laidOut({
  blockId: asBlockId('block-one'),
  lines: [
    { text: '甲', x: 0, width: 11 },
    { text: '乙', x: 4, width: 22 },
  ],
})

const RULE_BLOCK = laidOut({
  blockId: asBlockId('block-rule'),
  y: 33,
  height: 1,
  lines: [],
})

describe('projectLayoutToSheets', () => {
  const blocks = [textBlock('block-one', '甲\n乙'), dividerBlock('block-rule')]

  it('scales points into screen pixels and offsets by the page margins', () => {
    const sheets = projectLayoutToSheets(
      layoutWithPages([TWO_LINE_BLOCK, RULE_BLOCK]),
      blocks,
      A4_PAGE_SETUP,
      2,
    )

    expect(sheets).toHaveLength(1)
    expect(sheets[0]?.width).toBeCloseTo(A4_PAGE_SETUP.pageWidth * 2)
    expect(sheets[0]?.height).toBeCloseTo(A4_PAGE_SETUP.pageHeight * 2)
    expect(sheets[0]?.blocks[0]?.x).toBe(144)
    expect(sheets[0]?.blocks[0]?.y).toBe(144)
  })

  it('places every line at its own x and its own line box', () => {
    const sheet = projectLayoutToSheets(layoutWithPages([TWO_LINE_BLOCK]), blocks, A4_PAGE_SETUP, 2)[0]

    expect(sheet?.blocks[0]?.lines).toEqual([
      { text: '甲', x: 144, y: 144, width: 22, height: 33, fontSize: 22, fontFamily: 'sans-serif', fontWeight: 400 },
      { text: '乙', x: 152, y: 177, width: 44, height: 33, fontSize: 22, fontFamily: 'sans-serif', fontWeight: 400 },
    ])
  })

  it('marks a divider as a rule so the canvas draws something for it', () => {
    const sheets = projectLayoutToSheets(layoutWithPages([RULE_BLOCK]), blocks, A4_PAGE_SETUP, 1)

    expect(sheets).toHaveLength(1)
    expect(sheets[0]?.blocks[0]?.rule).toBe(true)
    expect(sheets[0]?.blocks[0]?.lines).toEqual([])
  })
})

describe('contentPointFromSheet', () => {
  it('converts a drawn position back into the content box', () => {
    expect(contentPointFromSheet({ x: 144, y: 177 }, A4_PAGE_SETUP, 2)).toEqual({ x: 0, y: 16.5 })
  })
})

describe('reorderIndexForDrop', () => {
  it('drops above the first remaining block', () => {
    expect(reorderIndexForDrop([TWO_LINE_BLOCK, RULE_BLOCK], TWO_LINE_BLOCK.blockId, 10)).toBe(0)
  })

  it('drops below every remaining block', () => {
    expect(reorderIndexForDrop([TWO_LINE_BLOCK, RULE_BLOCK], TWO_LINE_BLOCK.blockId, 400)).toBe(1)
  })

  it('leaves a block that was dropped on its own place alone', () => {
    expect(reorderIndexForDrop([TWO_LINE_BLOCK, RULE_BLOCK], TWO_LINE_BLOCK.blockId, 20)).toBe(0)
  })
})

describe('clampAbsolutePoint', () => {
  const box = { mode: 'absolute', x: 0, y: 0, width: 200, height: 40, zIndex: 0, rotation: 0 } as const

  it('keeps an absolute block on the paper', () => {
    const clamped = clampAbsolutePoint(A4_PAGE_SETUP, box, { x: 900, y: -30 })
    expect(clamped.x).toBeCloseTo(251.28)
    expect(clamped.y).toBe(0)
  })

  it('leaves a position inside the content box untouched', () => {
    expect(clampAbsolutePoint(A4_PAGE_SETUP, box, { x: 40, y: 60 })).toEqual({ x: 40, y: 60 })
  })
})

describe('fitWidthZoom', () => {
  it('fills the viewport minus the padding', () => {
    expect(fitWidthZoom(595.28, 1200)).toBeCloseTo((1200 - 96) / 595.28)
  })

  it('never leaves the readable range', () => {
    expect(fitWidthZoom(595.28, 80)).toBe(MIN_ZOOM)
    expect(fitWidthZoom(595.28, 100000)).toBe(MAX_ZOOM)
  })
})

describe('describeOverflow', () => {
  it('names both reasons layout() can report', () => {
    expect(describeOverflow('block-taller-than-page')).toContain('比一页还高')
    expect(describeOverflow('absolute-out-of-bounds')).toContain('超出')
  })
})

interface CanvasHarness {
  readonly onMoveBlock: ReturnType<typeof vi.fn>
  readonly onSelectBlock: ReturnType<typeof vi.fn>
}

function renderCanvas(overrides: Record<string, unknown> = {}): CanvasHarness {
  const onMoveBlock = vi.fn()
  const onSelectBlock = vi.fn()
  render(
    <ResumeCanvas
      layout={layoutWithPages([TWO_LINE_BLOCK, RULE_BLOCK])}
      page={A4_PAGE_SETUP}
      blocks={[textBlock('block-one', '甲\n乙'), dividerBlock('block-rule')]}
      editable
      selectedBlockId={null}
      onSelectBlock={onSelectBlock}
      onMoveBlock={onMoveBlock}
      {...overrides}
    />,
  )
  return { onMoveBlock, onSelectBlock }
}

function dragPointer(node: HTMLElement, type: 'dragstart' | 'dragmove' | 'dragend', clientX: number, clientY: number): void {
  fireEvent(node, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }))
}

function grab(node: HTMLElement, clientX: number, clientY: number): void {
  dragPointer(node, 'dragstart', clientX, clientY)
}

function dragTo(node: HTMLElement, clientX: number, clientY: number): void {
  dragPointer(node, 'dragmove', clientX, clientY)
}

function release(node: HTMLElement, clientX: number, clientY: number): void {
  dragPointer(node, 'dragend', clientX, clientY)
}

function blockNode(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-konva="rect"][data-node-id="${name}"]`)
  if (found === null) throw new Error(`The canvas drew no interactive node for "${name}".`)
  return found
}

describe('ResumeCanvas', () => {
  beforeEach(() => {
    resetKonvaNodePositions()
  })

  it('draws the lines layout produced without wrapping them again', () => {
    renderCanvas()

    const line = screen.getByText('乙')
    expect(line).toHaveAttribute('data-wrap', 'none')
    expect(line).toHaveAttribute('data-x', '19')
    expect(line).toHaveAttribute('data-y', '22.125')
    expect(line).toHaveAttribute('data-width', '5.5')
    expect(line).toHaveAttribute('data-font-size', '2.75')
  })

  it('keeps the decorative layer from listening', () => {
    renderCanvas()

    const decorative = document.querySelector('[data-konva="layer"][data-listening="false"]')
    expect(decorative).not.toBeNull()
  })

  it('reports the selected block when its node is clicked', () => {
    const { onSelectBlock } = renderCanvas()

    fireEvent.click(blockNode('block-one'))

    expect(onSelectBlock).toHaveBeenCalledWith('block-one')
  })

  it('moves between pages and reports which one is showing', () => {
    const second = laidOut({ blockId: asBlockId('block-two'), pageIndex: 1 })
    renderCanvas({ layout: layoutWithPages([TWO_LINE_BLOCK, second]) })

    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('shows an overflow report rather than clipping the block away', () => {
    renderCanvas({
      layout: {
        pages: [{ pageIndex: 0, blockIds: [TWO_LINE_BLOCK.blockId] }],
        blocks: [TWO_LINE_BLOCK],
        overflows: [{ blockId: TWO_LINE_BLOCK.blockId, reason: 'block-taller-than-page' }],
      },
    })

    expect(screen.getByText(/1 个区块放不进这一页/u)).toBeInTheDocument()
    expect(screen.getByText(/block-one/u)).toBeInTheDocument()
    expect(screen.getByText(/比一页还高/u)).toBeInTheDocument()
  })

  it('turns one continuous drag into one revision-sized intent', () => {
    const { onMoveBlock } = renderCanvas()
    const node = blockNode('block-one')

    grab(node, 20, 10)
    dragTo(node, 20, 10)
    dragTo(node, 22, 20)
    dragTo(node, 24, 30)
    release(node, 24, 30)

    expect(onMoveBlock).toHaveBeenCalledTimes(1)
    expect(onMoveBlock).toHaveBeenCalledWith({
      kind: 'reorder',
      blockId: 'block-one',
      toIndex: 1,
    })
  })

  it('puts the dragged node back where the layout put it', () => {
    renderCanvas()
    const node = blockNode('block-one')

    grab(node, 120, 200)
    release(node, 120, 200)

    expect(konvaNodePositions).toEqual([{ nodeId: 'block-one', x: 18, y: 18 }])
  })

  it('places an absolute block where it was dropped, inside the paper', () => {
    const absolute = absoluteBlock('block-absolute', 0, 0)
    const { onMoveBlock } = renderCanvas({
      layout: layoutWithPages([laidOut({ blockId: absolute.id })]),
      blocks: [absolute],
    })

    grab(blockNode('block-absolute'), 300, 400)
    release(blockNode('block-absolute'), 300, 400)

    expect(onMoveBlock).toHaveBeenCalledTimes(1)
    const move = onMoveBlock.mock.calls[0]?.[0]
    expect(move.kind).toBe('place')
    expect(move.blockId).toBe('block-absolute')
    expect(move.x).toBeCloseTo(251.28)
    expect(move.y).toBeCloseTo(657.89)
  })

  it('refuses to start a drag while the document is read-only', () => {
    const { onMoveBlock } = renderCanvas({ editable: false })

    expect(blockNode('block-one')).toHaveAttribute('data-draggable', 'false')
    grab(blockNode('block-one'), 24, 30)
    release(blockNode('block-one'), 24, 30)

    expect(onMoveBlock).not.toHaveBeenCalled()
  })

  it('re-fits when the frame itself changes size and the window does not', () => {
    renderCanvas()
    // jsdom never lays out, so fit-to-width starts pinned at the floor.
    expect(screen.getByText('25%')).toBeInTheDocument()

    const observer = TestResizeObserver.watching()[0]
    expect(observer).toBeDefined()
    const host = observer?.targets[0] as HTMLElement
    host.getBoundingClientRect = () => ({ width: 1200, height: 900 }) as DOMRect

    act(() => observer?.report(1200, 900))

    expect(screen.getByText('185%')).toBeInTheDocument()
  })

  it('stops watching the frame when it unmounts', () => {
    const { unmount } = render(
      <ResumeCanvas
        layout={layoutWithPages([TWO_LINE_BLOCK])}
        page={A4_PAGE_SETUP}
        blocks={[textBlock('block-one', '甲\n乙')]}
        editable
        selectedBlockId={null}
        onSelectBlock={vi.fn()}
        onMoveBlock={vi.fn()}
      />,
    )
    expect(TestResizeObserver.watching()).not.toHaveLength(0)

    unmount()

    expect(TestResizeObserver.watching()).toHaveLength(0)
  })

  it('removes its resize listener when it unmounts', () => {
    const removed = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(
      <ResumeCanvas
        layout={layoutWithPages([TWO_LINE_BLOCK])}
        page={A4_PAGE_SETUP}
        blocks={[textBlock('block-one', '甲\n乙')]}
        editable
        selectedBlockId={null}
        onSelectBlock={vi.fn()}
        onMoveBlock={vi.fn()}
      />,
    )

    unmount()

    expect(removed).toHaveBeenCalledWith('resize', expect.any(Function))
    removed.mockRestore()
  })
})
