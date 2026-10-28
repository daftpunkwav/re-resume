/**
 * @file resumeCanvas.browser.test
 * @description What only a real browser can answer about the resume canvas:
 * that Konva paints the pages, that a double click on a drawn block opens the
 * inline editor over it, and that Escape respects an IME composition (ignored
 * while composing, cancelling inside the short window after composition ends).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../src/presentation/app/ApplicationServicesProvider'
import { ResumePanel } from '../../src/presentation/features/resume/ResumePanel'
import { useResumeStore } from '../../src/presentation/features/resume/resumeStore'
import {
  blockScreenRect,
  canvasMetrics,
  pageBoxOf,
  projectResume,
} from '../../src/presentation/canvas/canvasProjection'
import {
  newResumeStudioRoot,
  seedResume,
  studioEntries,
} from '../support/resumeStudioRoot'
import '../../src/presentation/styles'

/** The canvas stacks pages with the same gap the viewport uses. */
const PAGE_GAP = 24

const user = userEvent.setup({ delay: null })

function renderPanel(root: Awaited<ReturnType<typeof newResumeStudioRoot>>['root']) {
  return render(
    <ApplicationServicesProvider createRoot={async () => root} resolveSnapshotPath={async () => 'test-hold'}>
      <div style={{ width: '900px', height: '900px' }}>
        <ResumePanel />
      </div>
    </ApplicationServicesProvider>,
  )
}

async function canvasElement(): Promise<HTMLCanvasElement> {
  const canvas = document.querySelector<HTMLCanvasElement>('.resume-panel canvas')
  if (canvas === null) throw new Error('The resume canvas did not mount.')
  return canvas
}

interface BlockPoint {
  readonly blockId: string
  readonly x: number
  readonly y: number
}

/** Client coordinates of the first editable entry block the stage paints. */
function editableBlockPoint(): BlockPoint {
  const state = useResumeStore.getState()
  const { resume, materialized, layout, zoom } = state
  if (resume === null || materialized === null || layout === null) {
    throw new Error('The studio has no rendered document.')
  }
  const projected = projectResume(materialized, layout, resume.document.pageSetup)
  const metrics = canvasMetrics(projected, zoom, PAGE_GAP)
  const block = projected.blocks.find(
    (candidate) =>
      candidate.pageIndex === 0 &&
      candidate.blockId.startsWith('entry:') &&
      !candidate.blockId.endsWith('title') &&
      candidate.height > 6,
  )
  if (block === undefined) throw new Error('The projected document has no entry block.')
  const box = pageBoxOf(metrics, block.pageIndex)
  if (box === null) throw new Error('The projected page is missing.')
  const rect = blockScreenRect(block, box, zoom)
  const canvas = document.querySelector<HTMLCanvasElement>('.resume-panel canvas')
  if (canvas === null) throw new Error('The resume canvas did not mount.')
  const canvasBox = canvas.getBoundingClientRect()
  return {
    blockId: block.blockId,
    x: canvasBox.left + rect.left + Math.min(rect.width / 2, 24),
    y: canvasBox.top + rect.top + Math.min(rect.height / 2, 6),
  }
}

/** Konva reads its pointer position from the pointer events before the dblclick. */
function doubleClickStage(canvas: HTMLCanvasElement, point: { x: number; y: number }): void {
  const opts = { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 0 }
  fireEvent.mouseDown(canvas, opts)
  fireEvent.mouseUp(canvas, opts)
  fireEvent.click(canvas, opts)
  fireEvent.mouseDown(canvas, opts)
  fireEvent.mouseUp(canvas, opts)
  fireEvent.dblClick(canvas, opts)
}

function keydown(target: EventTarget, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  useResumeStore.getState().detach()
})

afterEach(() => {
  cleanup()
  useResumeStore.getState().detach()
})

describe('resume canvas in a browser', () => {
  it('paints a page with Konva and opens the inline editor on a drawn block', async () => {
    const studio = newResumeStudioRoot()
    await seedResume(studio, { title: '浏览器简历', entries: studioEntries() })
    renderPanel(studio.root)
    await waitFor(() => expect(useResumeStore.getState().loadStatus).toBe('ready'), { timeout: 5000 })
    await screen.findByText('浏览器简历')

    const canvas = await canvasElement()
    await waitFor(() => expect(canvas.width).toBeGreaterThan(0))

    const point = editableBlockPoint()
    await act(async () => {
      doubleClickStage(canvas, point)
    })

    const editor = await screen.findByRole('textbox', { name: '编辑条目改写' })
    expect(editor).toHaveFocus()
    await user.clear(editor)
    await user.type(editor, '浏览器中的行内改写。')
    await user.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(() => expect(screen.queryByRole('textbox', { name: '编辑条目改写' })).toBeNull(), {
      timeout: 4000,
    })
    await waitFor(() =>
      expect(
        useResumeStore
          .getState()
          .resume?.document.overrides.some(
            (override) => override.target.kind === 'entry' && override.text === '浏览器中的行内改写。',
          ),
      ).toBe(true),
    )
  })

  it('ignores Escape while an IME composition is active and cancels just after it ends', async () => {
    const studio = newResumeStudioRoot()
    await seedResume(studio, { title: '浏览器简历', entries: studioEntries() })
    renderPanel(studio.root)
    await waitFor(() => expect(useResumeStore.getState().loadStatus).toBe('ready'), { timeout: 5000 })
    const canvas = await canvasElement()
    const point = editableBlockPoint()

    await act(async () => {
      doubleClickStage(canvas, point)
    })
    const editor = (await screen.findByRole('textbox', {
      name: '编辑条目改写',
    })) as HTMLTextAreaElement
    const revisionsBefore = useResumeStore.getState().revisions.length

    fireEvent.compositionStart(editor)
    let duringComposition!: KeyboardEvent
    act(() => {
      duringComposition = keydown(editor, 'Escape')
    })
    expect(duringComposition.defaultPrevented).toBe(false)
    expect(screen.queryByRole('textbox', { name: '编辑条目改写' })).not.toBeNull()

    fireEvent.compositionEnd(editor)
    act(() => {
      keydown(editor, 'Escape')
    })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '编辑条目改写' })).toBeNull())
    expect(useResumeStore.getState().revisions).toHaveLength(revisionsBefore)
  })
})
