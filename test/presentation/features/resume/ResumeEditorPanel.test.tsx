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

import { ResumeEditorPanel } from '../../../../src/presentation/features/resume/ResumeEditorPanel'
import type { FakeResumeServices } from '../../fakeResumeServices'
import { createFakeResumeServices } from '../../fakeResumeServices'
import {
  DRAFT_ID,
  FROZEN_ID,
  dividerBlock,
  layOutFixture,
  makeResume,
  materializedOf,
  textBlock,
} from '../../resumeFixtures'
import { resetKonvaNodePositions } from '../../konvaDouble'
import type { DocumentState } from '../../../../src/domain/resume/DocumentChange'
import type { Resume } from '../../../../src/domain/resume/Resume'
import type { LayoutOutput } from '../../../../src/domain/resume/PageLayout'
import type { OverflowReport } from '../../../../src/domain/resume/PageLayout'

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
  return {
    services,
    resume,
    resumeChanged,
    stored: () => stored,
  }
}

async function renderEditor(harness: Harness, resumeId: string = DRAFT_ID): Promise<void> {
  render(
    <ResumeEditorPanel
      resumeId={resumeId as Resume['id']}
      onResumeChanged={harness.resumeChanged}
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

  it('reports an overflow instead of letting the block disappear', async () => {
    const resume = makeResume()
    const harness = stubWorkbench(resume, {
      overflows: [{ blockId: resume.blocks[0]?.id as never, reason: 'block-taller-than-page' }],
    })
    await renderEditor(harness)

    expect(await screen.findByText('1 个区块放不进这一页')).toBeInTheDocument()
    expect(screen.getByText(/block-one/u)).toBeInTheDocument()
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
    expect(await screen.findByText('简历已定稿，导出将使用这份快照。')).toBeInTheDocument()
  })

  it('duplicates the document into a new draft', async () => {
    const harness = stubWorkbench(makeResume())
    await renderEditor(harness)

    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    await waitFor(() =>
      expect(harness.services.resumes.duplicate).toHaveBeenCalledWith({ sourceResumeId: DRAFT_ID }),
    )
    expect(await screen.findByText('已复制为一份新的草稿。')).toBeInTheDocument()
  })
})
