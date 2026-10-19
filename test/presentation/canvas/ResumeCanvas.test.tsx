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
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_TEXT_STYLE } from '../../../src/domain/resume/TextStyle'
import { asBlockId } from '../../../src/domain/shared/branded-id'
import {
  MAX_ZOOM,
  MIN_ABSOLUTE_SIZE,
  MIN_ZOOM,
  ResumeCanvas,
  clampAbsolutePoint,
  clampResizeSize,
  contentPointFromSheet,
  describeOverflow,
  fitWidthZoom,
  projectLayoutToSheets,
  reorderAnchorForDrop,
} from '../../../src/presentation/canvas/ResumeCanvas'
import type { LaidOutBlock } from '../../../src/domain/resume/PageLayout'
import type { Block } from '../../../src/domain/resume/Block'
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

describe('reorderAnchorForDrop', () => {
  it('drops above the first remaining block', () => {
    expect(reorderAnchorForDrop([TWO_LINE_BLOCK, RULE_BLOCK], TWO_LINE_BLOCK.blockId, 10)).toBe(
      RULE_BLOCK.blockId,
    )
  })

  it('drops below every remaining block', () => {
    expect(reorderAnchorForDrop([TWO_LINE_BLOCK, RULE_BLOCK], TWO_LINE_BLOCK.blockId, 400)).toBeNull()
  })

  it('leaves a block that was dropped on its own place alone', () => {
    expect(reorderAnchorForDrop([TWO_LINE_BLOCK, RULE_BLOCK], TWO_LINE_BLOCK.blockId, 20)).toBe(
      RULE_BLOCK.blockId,
    )
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

describe('clampResizeSize', () => {
  const box = { mode: 'absolute', x: 0, y: 0, width: 200, height: 40, zIndex: 0, rotation: 0 } as const

  it('keeps a box that fits the content box as it was drawn', () => {
    expect(clampResizeSize(A4_PAGE_SETUP, box, 200, 60)).toEqual({ width: 200, height: 60 })
  })

  it('never produces a block smaller than one that can be grabbed', () => {
    expect(clampResizeSize(A4_PAGE_SETUP, box, 2, -10)).toEqual({
      width: MIN_ABSOLUTE_SIZE,
      height: MIN_ABSOLUTE_SIZE,
    })
  })

  it('stops the corner at the paper rather than spilling past it', () => {
    const pinned = { ...box, x: 400, y: 600 } as const
    const size = clampResizeSize(A4_PAGE_SETUP, pinned, 500, 500)
    expect(size.width).toBeCloseTo(595.28 - 72 - 72 - 400)
    expect(size.height).toBeCloseTo(841.89 - 72 - 72 - 600)
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
  readonly onGesture: ReturnType<typeof vi.fn>
  readonly onSelectBlock: ReturnType<typeof vi.fn>
  readonly onEditText: ReturnType<typeof vi.fn>
}

function renderCanvas(overrides: Record<string, unknown> = {}): CanvasHarness {
  const onGesture = vi.fn()
  const onSelectBlock = vi.fn()
  const onEditText = vi.fn()
  render(
    <ResumeCanvas
      layout={layoutWithPages([TWO_LINE_BLOCK, RULE_BLOCK])}
      page={A4_PAGE_SETUP}
      blocks={[textBlock('block-one', '甲\n乙'), dividerBlock('block-rule')]}
      editable
      selectedBlockId={null}
      onSelectBlock={onSelectBlock}
      onGesture={onGesture}
      onEditText={onEditText}
      {...overrides}
    />,
  )
  return { onGesture, onSelectBlock, onEditText }
}

/** A canvas that can lose a block the way an undo would, mid editing session. */
function renderEditorWithBlocks(blocks: readonly Block[]): {
  readonly rerenderFn: (blocks: readonly Block[]) => void
} {
  const draw = (current: readonly Block[]): ReactElement => (
    <ResumeCanvas
      layout={layoutWithPages([TWO_LINE_BLOCK])}
      page={A4_PAGE_SETUP}
      blocks={current}
      editable
      selectedBlockId={null}
      onSelectBlock={vi.fn()}
      onGesture={vi.fn()}
      onEditText={vi.fn()}
    />
  )
  const utils = render(draw(blocks))
  return { rerenderFn: (next: readonly Block[]): void => utils.rerender(draw(next)) }
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

function resizeHandleNode(name: string): HTMLElement {
  const found = resizeHandleNodeOrNull(name)
  if (found === null) throw new Error(`The canvas drew no resize handle for "${name}".`)
  return found
}

function resizeHandleNodeOrNull(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-konva="rect"][data-node-id="resize-${name}"]`)
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
    const { onGesture } = renderCanvas()
    const node = blockNode('block-one')

    grab(node, 20, 10)
    dragTo(node, 20, 10)
    dragTo(node, 22, 20)
    dragTo(node, 24, 30)
    release(node, 24, 30)

    expect(onGesture).toHaveBeenCalledTimes(1)
    expect(onGesture).toHaveBeenCalledWith({
      kind: 'reorder',
      blockId: 'block-one',
      beforeBlockId: null,
    })
  })

  it('drops a flow block by its own centre rather than its top edge', () => {
    const { onGesture } = renderCanvas()
    const node = blockNode('block-one')

    // The block's top edge lands above the divider's middle, but the block's
    // own middle does not. Measuring the two the same way is what keeps a tall
    // block from jumping past a neighbour it is visibly still above.
    grab(node, 20, 24.25)
    release(node, 20, 24.25)

    expect(onGesture).toHaveBeenCalledWith({
      kind: 'reorder',
      blockId: 'block-one',
      beforeBlockId: null,
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
    const { onGesture } = renderCanvas({
      layout: layoutWithPages([laidOut({ blockId: absolute.id })]),
      blocks: [absolute],
    })

    grab(blockNode('block-absolute'), 300, 400)
    release(blockNode('block-absolute'), 300, 400)

    expect(onGesture).toHaveBeenCalledTimes(1)
    const move = onGesture.mock.calls[0]?.[0]
    expect(move.kind).toBe('place')
    expect(move.blockId).toBe('block-absolute')
    expect(move.x).toBeCloseTo(251.28)
    expect(move.y).toBeCloseTo(657.89)
  })

  it('turns a corner drag on an absolute block into one resize intent', () => {
    const absolute = absoluteBlock('block-absolute', 0, 0)
    const { onGesture } = renderCanvas({
      layout: layoutWithPages([laidOut({ blockId: absolute.id })]),
      blocks: [absolute],
    })
    const handle = resizeHandleNode('block-absolute')

    grab(handle, 100, 60)
    dragTo(handle, 140, 90)
    release(handle, 140, 90)

    expect(onGesture).toHaveBeenCalledTimes(1)
    const resize = onGesture.mock.calls[0]?.[0]
    expect(resize.kind).toBe('resize')
    expect(resize.blockId).toBe('block-absolute')
    // The pointer lands at content (122, 72) past the box corner; nothing
    // needs clamping here, so the drawn numbers come straight back.
    expect(resize.width).toBeCloseTo(122)
    expect(resize.height).toBeCloseTo(72)
    // The corner goes back to the laid-out geometry while the commit runs:
    // the drawn box is the content-width row the fixture layout produced.
    const reset = konvaNodePositions[0]
    expect(reset?.nodeId).toBe('resize-block-absolute')
    expect(reset?.x).toBeCloseTo(130.82)
    expect(reset?.y).toBeCloseTo(26.25)
  })

  it('offers no resize handle for a block whose height belongs to its content', () => {
    renderCanvas()

    expect(resizeHandleNodeOrNull('block-one')).toBeNull()
  })

  it('refuses to start a drag while the document is read-only', () => {
    const { onGesture } = renderCanvas({ editable: false })

    expect(blockNode('block-one')).toHaveAttribute('data-draggable', 'false')
    grab(blockNode('block-one'), 24, 30)
    release(blockNode('block-one'), 24, 30)

    expect(onGesture).not.toHaveBeenCalled()
  })

  it('opens the editor over a double-clicked text block and hides its drawn lines', () => {
    renderCanvas()

    fireEvent.dblClick(blockNode('block-one'))

    const area = screen.getByRole('textbox', { name: '编辑区块文字' })
    expect(area).toHaveValue('甲\n乙')
    // The drawn lines step aside for the editor: the same characters must not
    // be on the sheet and in the textarea at once.
    expect(screen.queryByText('甲')).not.toBeInTheDocument()
    expect(screen.queryByText('乙')).not.toBeInTheDocument()
  })

  it('does not open an editor over a block that draws no text of its own', () => {
    renderCanvas()

    fireEvent.dblClick(blockNode('block-rule'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('hands a committed session back as one edit intent', () => {
    const { onEditText } = renderCanvas()

    fireEvent.dblClick(blockNode('block-one'))
    const area = screen.getByRole('textbox', { name: '编辑区块文字' })
    fireEvent.change(area, { target: { value: '新的正文' } })
    fireEvent.blur(area)

    expect(onEditText).toHaveBeenCalledTimes(1)
    expect(onEditText).toHaveBeenCalledWith('block-one', '新的正文')
  })

  it('writes no edit intent when a session closes without changing the text', () => {
    const { onEditText } = renderCanvas()

    fireEvent.dblClick(blockNode('block-one'))
    fireEvent.blur(screen.getByRole('textbox', { name: '编辑区块文字' }))

    expect(onEditText).not.toHaveBeenCalled()
  })

  it('closes the editor when its block disappears from the document', () => {
    const { rerenderFn } = renderEditorWithBlocks([textBlock('block-one', '甲\n乙')])

    fireEvent.dblClick(blockNode('block-one'))
    expect(screen.getByRole('textbox', { name: '编辑区块文字' })).toBeInTheDocument()

    rerenderFn([dividerBlock('block-rule')])

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('refuses to open an editor while the document is read-only', () => {
    renderCanvas({ editable: false })

    fireEvent.dblClick(blockNode('block-one'))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
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
        onGesture={vi.fn()}
        onEditText={vi.fn()}
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
        onGesture={vi.fn()}
        onEditText={vi.fn()}
      />,
    )

    unmount()

    expect(removed).toHaveBeenCalledWith('resize', expect.any(Function))
    removed.mockRestore()
  })
})
