/**
 * @file ResumeEditorPanel.test
 * @description Every mutation the editor offers, seen from the composition
 * root: what it asks the workbench to do, and what the document looks like
 * afterwards.
 *
 * The workbench is a small in-memory fake that applies each committed change
 * to the document it holds, so a test can assert the stored result rather than
 * only the call.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import {
  convertBlockToAbsolute,
  convertBlockToFlow,
  nextAbsoluteZIndex,
  removeBlock,
  ResumeEditorPanel,
  updateBlockText,
} from '../../../../src/presentation/features/resume/ResumeEditorPanel'
import type { OperationOutcome } from '../../../../src/presentation/features/resume/ResumeEditorPanel'
import type { FakeResumeServices } from '../../fakeResumeServices'
import { createFakeResumeServices } from '../../fakeResumeServices'
import {
  DRAFT_ID,
  FROZEN_ID,
  absoluteBlock,
  dividerBlock,
  layOutFixture,
  makeResume,
  materializedOf,
  textBlock,
} from '../../resumeFixtures'
import { DEFAULT_FLOW_LAYOUT } from '../../../../src/domain/resume/Layout'
import { A4_PAGE_SETUP } from '../../../../src/domain/resume/PageSetup'
import type { Block } from '../../../../src/domain/resume/Block'
import { resetKonvaNodePositions } from '../../konvaDouble'
import type { DocumentState } from '../../../../src/domain/resume/DocumentChange'
import type { Resume } from '../../../../src/domain/resume/Resume'
import type { LayoutOutput } from '../../../../src/domain/resume/PageLayout'
import type { OverflowReport } from '../../../../src/domain/resume/PageLayout'
import { asBlockId } from '../../../../src/domain/shared/branded-id'

vi.mock('react-konva', async () => {
  const double = await import('../../konvaDouble')
  return {
    Stage: double.Stage,
    Layer: double.Layer,
    Group: double.Group,
    Rect: double.Rect,
    Text: double.Text,
  }
})

const servicesRef = vi.hoisted(() => ({ current: null as FakeResumeServices | null }))

vi.mock('../../../../src/presentation/app/ApplicationServicesProvider', () => ({
  useServices: () => {
    const services = servicesRef.current
    if (services === null) throw new Error('The fake composition root was never installed.')
    return services.root
  },
}))

interface Harness {
  readonly services: FakeResumeServices
  readonly resume: Resume
  readonly resumeChanged: Mock<() => void>
  readonly onOutcome: Mock<(outcome: OperationOutcome | null) => void>
  stored(): DocumentState
}

function stubWorkbench(
  resume: Resume,
  options: { readonly overflows?: readonly OverflowReport[] } = {},
): Harness {
  const services = createFakeResumeServices()
  let stored: DocumentState = { blocks: resume.blocks, pageSetup: resume.pageSetup }
  let seq = 1

  services.resumes.get.mockImplementation(async () => ({
    ...resume,
    blocks: stored.blocks,
    pageSetup: stored.pageSetup,
  }))
  services.resumes.materialize.mockImplementation(async () => stored.blocks.map(materializedOf))
  services.resumes.layOut.mockImplementation((blocks, page): LayoutOutput => {
    const laid = layOutFixture(blocks, page)
    return { ...laid, overflows: options.overflows ?? [] }
  })
  services.resumes.commit.mockImplementation(async (_id: unknown, change: { next: (state: DocumentState) => DocumentState; label: string }) => {
    stored = change.next(stored)
    seq += 1
    return { seq, label: change.label, state: stored }
  })
  services.resumes.undo.mockImplementation(async () => ({ seq, state: stored }))
  services.resumes.redo.mockImplementation(async () => ({ seq, state: stored }))
  services.resumes.freeze.mockImplementation(async () => ({ id: 'snapshot-1', resumeId: resume.id, seq: 1, materializedBlocks: stored.blocks, pageSetup: stored.pageSetup, createdAt: '2026-01-01T00:00:00.000Z' }))
  services.resumes.duplicate.mockResolvedValue('resume-copy')
  services.experiences.list.mockResolvedValue([])
  servicesRef.current = services

  const resumeChanged = vi.fn<() => void>()
  const onOutcome = vi.fn<(outcome: OperationOutcome | null) => void>()
  return {
    services,
    resume,
    resumeChanged,
    onOutcome,
    stored: () => stored,
  }
}

async function renderEditor(harness: Harness, resumeId: string = DRAFT_ID): Promise<void> {
  render(
    <ResumeEditorPanel
      resumeId={resumeId as Resume['id']}
      onResumeChanged={harness.resumeChanged}
      onOutcome={harness.onOutcome}
    />,
  )
  // The panel reads the resume, then materializes and lays it out; the drawn
  // body text is the last thing to appear.
  await screen.findByText('第一段正文')
}

function blockNode(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-konva="rect"][data-node-id="${name}"]`)
  if (found === null) throw new Error(`The canvas drew no node for "${name}".`)
  return found
}

function drag(node: HTMLElement, from: [number, number], path: readonly [number, number][]): void {
  const at = (type: 'dragstart' | 'dragmove' | 'dragend', point: readonly [number, number]): void => {
    fireEvent(node, new MouseEvent(type, { bubbles: true, clientX: point[0], clientY: point[1] }))
  }
  at('dragstart', from)
  for (const point of path) at('dragmove', point)
  at('dragend', path[path.length - 1] ?? from)
}

describe('ResumeEditorPanel', () => {
  beforeEach(() => {
    resetKonvaNodePositions()
  })

  it('undoes and redoes through the workbench', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(harness.services.resumes.undo).toHaveBeenCalledWith(DRAFT_ID))

    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    await waitFor(() => expect(harness.services.resumes.redo).toHaveBeenCalledWith(DRAFT_ID))
  })

  it('exports a PDF through the workbench and reports where the file landed', async () => {
    const harness = stubWorkbench(makeResume())
    harness.services.resumes.exportPdfToFile.mockResolvedValue({
      outcome: 'saved',
      path: 'C:/Users/demo/Documents/简历.pdf',
      pendingClaimBlocks: [],
    })
    await renderEditor(harness)

    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }))
    await waitFor(() =>
      expect(harness.services.resumes.exportPdfToFile).toHaveBeenCalledWith(DRAFT_ID),
    )
    await waitFor(() =>
      expect(harness.onOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'success',
          title: expect.stringContaining('简历.pdf'),
        }),
      ),
    )
  })

  it('warns when the exported PDF still cites pending claims', async () => {
    const harness = stubWorkbench(makeResume())
    harness.services.resumes.exportPdfToFile.mockResolvedValue({
      outcome: 'saved',
      path: 'C:/Users/demo/Documents/简历.pdf',
      pendingClaimBlocks: [asBlockId('block-1')],
    })
    await renderEditor(harness)

    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }))
    await waitFor(() =>
      expect(harness.onOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'warning' }),
      ),
    )
  })

  it('reports nothing when the save dialog is dismissed', async () => {
    const harness = stubWorkbench(makeResume())
    harness.services.resumes.exportPdfToFile.mockResolvedValue({ outcome: 'cancelled' })
    await renderEditor(harness)

    fireEvent.click(screen.getByRole('button', { name: '导出 PDF' }))
    await waitFor(() => expect(harness.services.resumes.exportPdfToFile).toHaveBeenCalled())
    // dispatch clears the outcome before the run; a dismissal sets no new one.
    const outcomeCalls = harness.onOutcome.mock.calls.filter(([outcome]) => outcome !== null)
    expect(outcomeCalls).toHaveLength(0)
  })

  it('commits a page setup change as one undoable revision', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    const width = screen.getByLabelText('页面宽度（pt）')
    fireEvent.change(width, { target: { value: '620' } })
    fireEvent.blur(width)

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    const [resumeId, change] = harness.services.resumes.commit.mock.calls[0] as [string, { label: string; next: (state: DocumentState) => DocumentState }]
    expect(resumeId).toBe(DRAFT_ID)
    expect(change.label).toBe('调整页面设置')
    expect(change.next({ blocks: [], pageSetup: harness.resume.pageSetup }).pageSetup.pageWidth).toBe(620)
    expect(harness.stored().pageSetup.pageWidth).toBe(620)
  })

  it('writes one revision for a whole typed measurement, not one per keystroke', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    // 5 → 6 → 62 → 620: three intermediate values are not measurements, and
    // none of them may reach the document.
    const width = screen.getByLabelText('页面宽度（pt）')
    fireEvent.change(width, { target: { value: '6' } })
    fireEvent.change(width, { target: { value: '62' } })
    fireEvent.change(width, { target: { value: '620' } })
    expect(harness.services.resumes.commit).not.toHaveBeenCalled()

    fireEvent.keyDown(width, { key: 'Enter' })

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    expect(harness.stored().pageSetup.pageWidth).toBe(620)
  })

  it('refuses a page measurement that is not a positive number', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    const height = screen.getByLabelText('页面高度（pt）')
    fireEvent.change(height, { target: { value: '0' } })
    fireEvent.blur(height)

    expect(screen.getByText('请输入大于 0 的数字。')).toBeInTheDocument()
    expect(harness.services.resumes.commit).not.toHaveBeenCalled()
    expect(harness.resume.pageSetup.pageHeight).not.toBe(0)
  })

  it('writes nothing while a measurement is still half typed', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    // Clearing a number field is the shortest possible half-measurement: an
    // empty string parses to nothing and must not reach the document.
    const width = screen.getByLabelText('页面宽度（pt）')
    fireEvent.change(width, { target: { value: '' } })
    fireEvent.blur(width)

    expect(screen.getByText('请输入大于 0 的数字。')).toBeInTheDocument()
    expect(harness.services.resumes.commit).not.toHaveBeenCalled()
  })

  it('turns one continuous drag into exactly one revision', async () => {
    const resume = makeResume({
      blocks: [textBlock('block-one', '第一段正文'), dividerBlock('block-rule')],
    })
    const harness = stubWorkbench(resume)
    await renderEditor(harness)

    drag(blockNode('block-one'), [20, 20], [
      [20, 60],
      [20, 120],
      [20, 200],
    ])

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    expect(harness.stored().blocks.map((block) => block.id)).toEqual(['block-rule', 'block-one'])
    expect(harness.services.resumes.commit.mock.calls[0]?.[1].label).toBe('移动区块')
  })

  it('commits a corner drag as one resize revision', async () => {
    const resume = makeResume({
      blocks: [textBlock('block-one', '第一段正文'), absoluteBlock('block-pinned', 0, 0)],
    })
    const harness = stubWorkbench(resume)
    await renderEditor(harness)

    const handle = document.querySelector<HTMLElement>(
      '[data-konva="rect"][data-node-id="resize-block-pinned"]',
    )
    if (handle === null) throw new Error('The canvas drew no resize handle for "block-pinned".')
    drag(handle, [130.82, 28], [[100, 80]])

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    expect(harness.services.resumes.commit.mock.calls[0]?.[1].label).toBe('调整区块大小')
    // The corner travelled (82, 57) screen pixels; at the canvas's 25%
    // fit-width zoom that is (328, 228) content points — the units the stored
    // box is written in, and neither size meets the paper edge.
    expect(harness.stored().blocks[1]?.layout).toMatchObject({ width: 328, height: 228 })
  })

  it('anchors a reorder against the flow sequence, even with a pinned block between', async () => {
    const resume = makeResume({
      blocks: [
        textBlock('block-one', '第一段正文'),
        absoluteBlock('block-pinned', 0, 0),
        textBlock('block-two', '第二段正文'),
      ],
    })
    const harness = stubWorkbench(resume)
    await renderEditor(harness)

    // Dropping block-two above block-one names block-one as the anchor; a
    // numeric index counted on the drawn order would have landed on the
    // pinned block sitting between them.
    drag(blockNode('block-two'), [20, 0], [[20, 0]])

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    expect(harness.stored().blocks.map((block) => block.id)).toEqual([
      'block-two',
      'block-one',
      'block-pinned',
    ])
  })

  it('trades z positions with the neighbouring absolute block', async () => {
    const pinned = (id: string, zIndex: number): Block => ({
      ...absoluteBlock(id, 0, 0),
      layout: { mode: 'absolute', x: 0, y: 0, width: 200, height: 40, zIndex, rotation: 0 },
    })
    const resume = makeResume({
      blocks: [
        textBlock('block-one', '第一段正文'),
        pinned('block-low', 1),
        pinned('block-high', 2),
      ],
    })
    const harness = stubWorkbench(resume)
    await renderEditor(harness)

    fireEvent.click(blockNode('block-low'))
    expect(screen.getByRole('button', { name: '下移一层' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '上移一层' }))

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    expect(harness.services.resumes.commit.mock.calls[0]?.[1].label).toBe('调整层级')
    expect(harness.stored().blocks[1]?.layout).toMatchObject({ zIndex: 2 })
    expect(harness.stored().blocks[2]?.layout).toMatchObject({ zIndex: 1 })
  })

  it('offers no z swap between blocks the draw order cannot separate', async () => {
    const pinned = (id: string, zIndex: number): Block => ({
      ...absoluteBlock(id, 0, 0),
      layout: { mode: 'absolute', x: 0, y: 0, width: 200, height: 40, zIndex, rotation: 0 },
    })
    const resume = makeResume({
      blocks: [textBlock('block-one', '第一段正文'), pinned('block-a', 1), pinned('block-b', 1)],
    })
    const harness = stubWorkbench(resume)
    await renderEditor(harness)

    fireEvent.click(blockNode('block-a'))

    // Equal z draws in document order, so a swap would write a revision that
    // changes nothing; both affordances stay off rather than recording one.
    expect(screen.getByRole('button', { name: '上移一层' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下移一层' })).toBeDisabled()
    expect(harness.services.resumes.commit).not.toHaveBeenCalled()
  })

  it('adds a block through the same commit path', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    fireEvent.change(screen.getByLabelText('文字内容'), { target: { value: '自我评价' } })
    fireEvent.click(screen.getByRole('button', { name: '添加文字区块' }))

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    const stored = harness.stored()
    expect(stored.blocks).toHaveLength(3)
    expect(stored.blocks[2]?.content).toEqual({ type: 'text', text: '自我评价' })
  })

  it('commits a canvas editing session as one revision', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    fireEvent.dblClick(blockNode('block-one'))
    const area = screen.getByRole('textbox', { name: '编辑区块文字' })
    fireEvent.change(area, { target: { value: '改写后的第一段' } })
    fireEvent.blur(area)

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    expect(harness.services.resumes.commit.mock.calls[0]?.[1].label).toBe('编辑文字')
    expect(harness.stored().blocks[0]?.content).toEqual({ type: 'text', text: '改写后的第一段' })
    // The committed text is drawn from the document, not from the editor.
    await screen.findByText('改写后的第一段')
  })

  it('leaves a block an undo removed mid session untouched', () => {
    const change = updateBlockText('编辑文字', asBlockId('block-gone'), '无处落笔')
    const state = { blocks: [], pageSetup: makeResume().pageSetup }

    expect(change.next(state)).toBe(state)
  })

  it('removes the selected block through the same commit path', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    fireEvent.click(blockNode('block-one'))
    expect(screen.getByText('选中区块')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除区块' }))

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    expect(harness.services.resumes.commit.mock.calls[0]?.[1].label).toBe('删除区块')
    expect(harness.stored().blocks.map((block) => block.id)).toEqual(['block-two'])
    // The panel follows the document: no block, no actions row.
    await waitFor(() => expect(screen.queryByText('选中区块')).not.toBeInTheDocument())
  })

  it('pins a flow block where the layout drew it', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    fireEvent.click(blockNode('block-one'))
    fireEvent.click(screen.getByRole('button', { name: '转为绝对定位' }))

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    const layout = harness.stored().blocks[0]?.layout
    expect(layout).toEqual({
      mode: 'absolute',
      x: 0,
      y: 0,
      width: A4_PAGE_SETUP.pageWidth - A4_PAGE_SETUP.marginLeft - A4_PAGE_SETUP.marginRight,
      height: 20,
      zIndex: 1,
      rotation: 0,
    })
  })

  it('returns an absolute block to the flow sequence', async () => {
    const resume = makeResume({
      blocks: [textBlock('block-one', '第一段正文'), absoluteBlock('block-pinned', 30, 40)],
    })
    const harness = stubWorkbench(resume)
    await renderEditor(harness)

    fireEvent.click(blockNode('block-pinned'))
    fireEvent.click(screen.getByRole('button', { name: '转为常规流' }))

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(1))
    expect(harness.stored().blocks[1]?.layout).toEqual(DEFAULT_FLOW_LAYOUT)
  })

  it('offers no pin to a flow block drawn on a later page', async () => {
    const harness = stubWorkbench(makeResume())
    // A two-page preview: block-two draws on page 2, where v1 has no absolute
    // placement — pinning it would silently move it back to page 1.
    harness.services.resumes.layOut.mockImplementation((blocks, page) => {
      const laid = layOutFixture(blocks, page)
      const second = { ...laid.blocks[1], pageIndex: 1 }
      return {
        ...laid,
        blocks: [laid.blocks[0], second],
        pages: [
          { pageIndex: 0, blockIds: [laid.blocks[0]?.blockId] },
          { pageIndex: 1, blockIds: [second.blockId] },
        ],
      }
    })
    await renderEditor(harness)

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(blockNode('block-two'))

    expect(screen.getByRole('button', { name: '转为绝对定位' })).toBeDisabled()
    expect(screen.getByText('绝对定位目前只支持第一页的区块。')).toBeInTheDocument()
  })

  it('hands a converted block the next z position above the ones already there', () => {
    const pinned = (id: string, zIndex: number): Block => ({
      ...absoluteBlock(id, 0, 0),
      layout: { mode: 'absolute', x: 0, y: 0, width: 200, height: 40, zIndex, rotation: 0 },
    })
    const blocks = [pinned('block-low', 2), textBlock('block-mid', '正文'), pinned('block-high', 5)]

    expect(nextAbsoluteZIndex(blocks)).toBe(6)
  })

  it('refuses conversions and removals for blocks the document does not hold', () => {
    const state = { blocks: [], pageSetup: makeResume().pageSetup }
    const box = { x: 0, y: 0, width: 100, height: 20 }

    expect(removeBlock('删除区块', asBlockId('block-gone')).next(state)).toBe(state)
    expect(convertBlockToAbsolute('转为绝对定位', asBlockId('block-gone'), box, 1).next(state)).toBe(state)
    expect(convertBlockToFlow('转为常规流', asBlockId('block-gone')).next(state)).toBe(state)
  })

  it('reports an overflow instead of letting the block disappear', async () => {
    const resume = makeResume()
    const harness = stubWorkbench(resume, {
      overflows: [{ blockId: resume.blocks[0]?.id as never, reason: 'block-taller-than-page' }],
    })
    await renderEditor(harness)

    expect(await screen.findByText('1 个区块放不进这一页')).toBeInTheDocument()
    expect(screen.getByText(/block-one/u)).toBeInTheDocument()
  })

  it('builds the next measurement from the stored setup, not from a refused one', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)
    // A document that refuses everything, the way a frozen one does.
    harness.services.resumes.commit.mockRejectedValue(
      new Error('这份简历已定稿，复制一份新的草稿再继续修改。'),
    )

    const width = screen.getByLabelText('页面宽度（pt）')
    fireEvent.change(width, { target: { value: '620' } })
    fireEvent.blur(width)
    await screen.findByText('这份简历已定稿，复制一份新的草稿再继续修改。')

    // The refused width never reached the document, so the next edit has to
    // propose the stored width back — not the refused one alongside it.
    const height = screen.getByLabelText('页面高度（pt）')
    fireEvent.change(height, { target: { value: '700' } })
    fireEvent.blur(height)

    await waitFor(() => expect(harness.services.resumes.commit).toHaveBeenCalledTimes(2))
    const change = harness.services.resumes.commit.mock.calls[1]?.[1] as {
      next: (state: DocumentState) => DocumentState
    }
    const proposed = change.next({ blocks: [], pageSetup: harness.resume.pageSetup }).pageSetup
    expect(proposed.pageHeight).toBe(700)
    expect(proposed.pageWidth).toBe(harness.resume.pageSetup.pageWidth)
  })

  it('reports what stopped a refused change', async () => {
    const harness = stubWorkbench(makeResume())
    harness.services.resumes.commit.mockRejectedValue(
      Object.assign(new Error('这份简历已定稿，复制一份新的草稿再继续修改。'), {}),
    )
    await renderEditor(harness)

    fireEvent.change(screen.getByLabelText('页面宽度（pt）'), { target: { value: '620' } })
    fireEvent.blur(screen.getByLabelText('页面宽度（pt）'))

    expect(await screen.findByText('这份简历已定稿，复制一份新的草稿再继续修改。')).toBeInTheDocument()
  })

  it('makes a frozen resume read-only and says why', async () => {
    const resume = makeResume({ id: FROZEN_ID, status: 'frozen' })
    const harness = stubWorkbench(resume)
    await renderEditor(harness, FROZEN_ID)

    expect(screen.getByText('已定稿，复制一份草稿继续修改')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '定稿' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '添加文字区块' })).toBeDisabled()
    expect(screen.getByLabelText('页面宽度（pt）')).toBeDisabled()
    expect(blockNode('block-one')).toHaveAttribute('data-draggable', 'false')
  })

  it('confirms the consequences before freezing', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    fireEvent.click(screen.getByRole('button', { name: '定稿' }))
    const dialog = screen.getByRole('dialog', { name: '定稿这份简历' })
    fireEvent.click(within(dialog).getByRole('button', { name: '定稿' }))

    await waitFor(() => expect(harness.services.resumes.freeze).toHaveBeenCalledWith(DRAFT_ID))
    // The outcome is reported upwards: the workspace holds it, because a
    // panel keyed by the selection would be remounted by its own notice.
    await waitFor(() =>
      expect(harness.onOutcome).toHaveBeenCalledWith({
        tone: 'success',
        title: '简历已定稿，导出将使用这份快照。',
      }),
    )
  })

  it('duplicates the document into a new draft', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    await waitFor(() =>
      expect(harness.services.resumes.duplicate).toHaveBeenCalledWith({ sourceResumeId: DRAFT_ID }),
    )
    await waitFor(() =>
      expect(harness.onOutcome).toHaveBeenCalledWith({
        tone: 'success',
        title: '已复制为一份新的草稿。',
      }),
    )
  })
})
