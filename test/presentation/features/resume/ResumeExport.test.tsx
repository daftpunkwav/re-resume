/**
 * @file ResumeExport.test
 * @description The studio's export entry: the toolbar button, the plan dialog
 * that must come before the save dialog, the draft/frozen sentence, the
 * warnings, the saved file, a cancelled dialog and a refused plan with retry.
 * The PDF renderer is replaced by a recording capability, so this test is about
 * the panel contract rather than about bytes.
 */

import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompositionRoot } from '../../../../src/bootstrap/capabilities'
import type {
  ExportPdfOutput,
  PdfExportPlan,
} from '../../../../src/application/export/exportPdf'
import { DomainError } from '../../../../src/domain/shared/DomainError'
import { asLayoutBlockId } from '../../../../src/domain/shared/branded-id'
import { ApplicationServicesProvider } from '../../../../src/presentation/app/ApplicationServicesProvider'
import { useToastStore } from '../../../../src/presentation/app/stores/toastStore'
import { ExportResumeDialog } from '../../../../src/presentation/features/resume/ExportResumeDialog'
import { ResumePanel } from '../../../../src/presentation/features/resume/ResumePanel'
import { useResumeStore } from '../../../../src/presentation/features/resume/resumeStore'
import { aResume } from '../../../support/resumeFixtures'
import { newResumeStudioRoot, seedResume } from '../../../support/resumeStudioRoot'
import type { ResumeStudioRoot } from '../../../support/resumeStudioRoot'
import { stubCompositionRoot } from '../../../support/stubCompositionRoot'

vi.mock('react-konva', async () => {
  const React = await import('react')
  const container = (props: { readonly children?: ReactNode }) =>
    React.createElement('div', null, props.children)
  const nothing = () => null
  return {
    Stage: container,
    Layer: container,
    Group: container,
    Rect: nothing,
    Line: nothing,
    Text: (props: { readonly text?: string }) => React.createElement('span', null, props.text),
  }
})

const user = userEvent.setup({ delay: null })

const PLAN: PdfExportPlan = {
  suggestedFileName: '林清越-前端工程师.pdf',
  pageCount: 2,
  overflows: [],
  warnings: ['draft-exported'],
  frozen: false,
}

const WARNING_PLAN: PdfExportPlan = {
  ...PLAN,
  warnings: ['draft-exported', 'missing-reference', 'text-overflow'],
  overflows: [
    { blockId: asLayoutBlockId('block-overflow'), pageIndex: 0, reason: 'absolute-out-of-bounds' },
  ],
}

interface FakeExport {
  readonly service: CompositionRoot['export']
  readonly prepared: string[]
  readonly exported: string[]
}

function fakeExport(options: {
  readonly plan?: PdfExportPlan
  readonly savePath?: string | null
  readonly prepareError?: unknown
  readonly exportError?: unknown
} = {}): FakeExport {
  const prepared: string[] = []
  const exported: string[] = []
  const plan = options.plan ?? PLAN
  const result: ExportPdfOutput = {
    ...plan,
    bytes: new Uint8Array([1, 2, 3]),
    savedPath: options.savePath === undefined ? 'C:\\out\\林清越-前端工程师.pdf' : options.savePath,
  }
  return {
    prepared,
    exported,
    service: {
      preparePdfExport: async (input) => {
        prepared.push(input.resumeId)
        if (options.prepareError !== undefined) throw options.prepareError
        return plan
      },
      exportPdf: async (input) => {
        exported.push(input.resumeId)
        if (options.exportError !== undefined) throw options.exportError
        return result
      },
    },
  }
}

function resumeNotFound(): DomainError {
  return new DomainError('resumeNotFound', 'The resume does not exist.', {
    entity: 'resume',
    id: 'missing',
    blockers: ['missing'],
  })
}

function withRoot(root: CompositionRoot, children: ReactNode) {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => root}
      resolveSnapshotPath={async () => 'test-credentials.hold'}
    >
      {children}
    </ApplicationServicesProvider>,
  )
}

function renderPanel(studio: ResumeStudioRoot) {
  return withRoot(
    studio.root,
    <div style={{ width: '800px', height: '900px' }}>
      <ResumePanel />
    </div>,
  )
}

async function openExport(studio: ResumeStudioRoot): Promise<HTMLElement> {
  renderPanel(studio)
  await user.click(await screen.findByRole('button', { name: '导出 PDF' }))
  return screen.findByRole('dialog', { name: '导出 PDF' })
}

/** The dialog's footer confirm button (the second footer action). */
function confirmButton(): HTMLButtonElement {
  const buttons = document.querySelector('.dialog-foot')?.querySelectorAll('button')
  const confirm = buttons?.[1]
  if (confirm === undefined) throw new Error('The dialog has no confirm button yet.')
  return confirm as HTMLButtonElement
}

beforeEach(() => {
  useResumeStore.getState().detach()
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  cleanup()
  useResumeStore.getState().detach()
})

describe('the resume export entry', () => {
  it('shows the plan, its warnings and the overflow count before saving', async () => {
    const fake = fakeExport({ plan: WARNING_PLAN })
    const studio = newResumeStudioRoot({ exportService: fake.service })
    const seeded = await seedResume(studio, { title: '前端简历' })

    const dialog = await openExport(studio)

    expect(within(dialog).getByText(/定稿后再导出可获得固定快照/)).toBeInTheDocument()
    expect(within(dialog).getByText('2 页')).toBeInTheDocument()
    expect(within(dialog).getByText('林清越-前端工程师.pdf')).toBeInTheDocument()
    expect(within(dialog).getByText('当前草稿')).toBeInTheDocument()
    expect(within(dialog).getByText(/失效的引用/)).toBeInTheDocument()
    expect(within(dialog).getByText(/超出页面/)).toBeInTheDocument()
    expect(within(dialog).getByText(/1 处溢出/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '仍然导出' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '导出 PDF' })).toBeNull())
    expect(fake.prepared).toEqual([seeded.resumeId])
    expect(fake.exported).toEqual([seeded.resumeId])
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('已导出 PDF')
    expect(useToastStore.getState().toasts.at(-1)?.tone).toBe('success')
  })

  it('offers 导出 PDF when the plan carries no warning', async () => {
    const fake = fakeExport({ plan: { ...PLAN, warnings: [] } })
    const studio = newResumeStudioRoot({ exportService: fake.service })
    await seedResume(studio, { title: '前端简历' })

    const dialog = await openExport(studio)

    expect(within(dialog).getByRole('button', { name: '导出 PDF' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '仍然导出' })).toBeNull()
  })

  it('reports a cancelled dialog as information, not as an error', async () => {
    const fake = fakeExport({ plan: { ...PLAN, warnings: [] }, savePath: null })
    const studio = newResumeStudioRoot({ exportService: fake.service })
    await seedResume(studio, { title: '前端简历' })

    const dialog = await openExport(studio)
    await user.click(within(dialog).getByRole('button', { name: '导出 PDF' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '导出 PDF' })).toBeNull())
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('已取消导出')
    expect(useToastStore.getState().toasts.at(-1)?.tone).toBe('info')
  })

  it('shows a refused plan in place and retries it', async () => {
    const attempts: PdfExportPlan[] = []
    const service: CompositionRoot['export'] = {
      preparePdfExport: async () => {
        if (attempts.length === 0) {
          attempts.push(PLAN)
          throw resumeNotFound()
        }
        attempts.push(PLAN)
        return PLAN
      },
      exportPdf: async () => ({ ...PLAN, bytes: new Uint8Array(), savedPath: 'C:\\out.pdf' }),
    }
    const studio = newResumeStudioRoot({ exportService: service })
    await seedResume(studio, { title: '前端简历' })

    const dialog = await openExport(studio)
    await within(dialog).findByText('找不到这份简历，它可能已被删除。')

    await user.click(within(dialog).getByRole('button', { name: '重试检查' }))

    expect(await within(dialog).findByText('2 页')).toBeInTheDocument()
    expect(attempts).toHaveLength(2)
  })

  it('disables the confirm action while the plan is being prepared', async () => {
    let finishPlan: (plan: PdfExportPlan) => void = () => undefined
    const pending = new Promise<PdfExportPlan>((resolve) => {
      finishPlan = resolve
    })
    const service: CompositionRoot['export'] = {
      preparePdfExport: () => pending,
      exportPdf: async () => ({ ...PLAN, bytes: new Uint8Array(), savedPath: 'C:\\out.pdf' }),
    }
    withRoot(
      stubCompositionRoot({ export: service }),
      <ExportResumeDialog resume={aResume({ id: 'resume-plan' }).resume} open onClose={() => undefined} />,
    )

    expect(await screen.findByText('正在检查排版…')).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()

    finishPlan(PLAN)
    await waitFor(() => expect(confirmButton()).toBeEnabled())
  })

  it('states the frozen export semantics for a finalized resume', async () => {
    const frozen = aResume({ id: 'resume-frozen', status: 'frozen', snapshots: [] }).resume
    const fake = fakeExport({ plan: { ...PLAN, frozen: true, warnings: [] } })

    withRoot(
      stubCompositionRoot({ export: fake.service }),
      <ExportResumeDialog resume={frozen} open onClose={() => undefined} />,
    )

    expect(await screen.findByText(/已定稿/)).toBeInTheDocument()
    expect(await screen.findByText('定稿快照')).toBeInTheDocument()
  })
})
