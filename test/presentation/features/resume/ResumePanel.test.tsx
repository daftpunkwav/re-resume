/**
 * @file ResumePanel.test
 * @description The studio panel in jsdom with the Konva surface replaced by
 * inert elements: lifecycle chrome, the chapter list and entry picker, the
 * three editing tabs, the template gallery and the freeze transition. The
 * canvas drawing itself is covered by the browser test.
 */

import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationServicesProvider } from '../../../../src/presentation/app/ApplicationServicesProvider'
import { ResumePanel } from '../../../../src/presentation/features/resume/ResumePanel'
import { useResumeStore } from '../../../../src/presentation/features/resume/resumeStore'
import {
  newResumeStudioRoot,
  seedResume,
  type ResumeStudioRoot,
} from '../../../support/resumeStudioRoot'

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

function renderPanel(studio: ResumeStudioRoot) {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => studio.root}
      resolveSnapshotPath={async () => 'test-credentials.hold'}
    >
      <div style={{ width: '800px', height: '900px' }}>
        <ResumePanel />
      </div>
    </ApplicationServicesProvider>,
  )
}

beforeEach(() => {
  useResumeStore.getState().detach()
})

afterEach(() => {
  cleanup()
  useResumeStore.getState().detach()
})

describe('ResumePanel', () => {
  it('loads the open resume, lists its chapters and applies an entry selection', async () => {
    const studio = newResumeStudioRoot()
    await seedResume(studio, { title: '前端简历' })
    renderPanel(studio)

    await waitFor(() => expect(screen.getByText('前端简历')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /当前简历/ })).toBeInTheDocument()
    const initialRevision = document.querySelector('.studio-revision-label')?.textContent ?? ''
    expect(initialRevision).toMatch(/修订 \d+ · /)
    expect(screen.getByRole('tab', { name: '组合' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '外观' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '页面' })).toBeInTheDocument()
    expect(screen.getByText('个人信息')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: '展开条目' })[0] as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('.entry-row .entry-title')?.textContent).toBe('林清越')
    )
    await user.click(screen.getAllByRole('button', { name: /选择条目/ })[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog', { name: /选择.*条目/ })
    expect(dialog).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '移除 林清越' }))
    await user.click(screen.getByRole('button', { name: '应用选择' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /选择.*条目/ })).toBeNull())
    await waitFor(() =>
      expect(document.querySelector('.studio-revision-label')?.textContent).not.toBe(initialRevision)
    )
  })

  it('switches template through the gallery and paper through the page tab', async () => {
    const studio = newResumeStudioRoot()
    await seedResume(studio, { title: '前端简历' })
    renderPanel(studio)
    await waitFor(() => expect(screen.getByText('前端简历')).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: '外观' }))
    await screen.findByRole('radiogroup', { name: '简历模板' })
    expect(document.querySelectorAll('.template-card')).toHaveLength(6)
    const technical = screen.getByRole('radio', { name: /技术岗/ })
    await user.click(technical)
    await waitFor(() => expect(screen.getByRole('radio', { name: /技术岗/ })).toHaveAttribute('aria-checked', 'true'))
    await waitFor(() =>
      expect(document.querySelector('.studio-revision-label')?.textContent).toMatch(/切换模板/)
    )

    await user.click(screen.getByRole('tab', { name: '页面' }))
    const letter = await screen.findByRole('radio', { name: 'Letter' })
    await user.click(letter)
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Letter' })).toHaveAttribute('aria-checked', 'true'))
  })

  it('freezes the resume and locks the revision controls', async () => {
    const studio = newResumeStudioRoot()
    await seedResume(studio, { title: '前端简历' })
    renderPanel(studio)
    await waitFor(() => expect(screen.getByText('前端简历')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /^定稿$/ }))
    const dialog = await screen.findByRole('dialog', { name: '定稿这份简历' })
    expect(dialog).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '定稿并创建快照' }))

    await waitFor(() => expect(screen.getAllByText('已定稿').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: '复制为新草稿' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^定稿$/ })).toBeNull()
  })

  it('offers creation when there is no resume yet', async () => {
    const studio = newResumeStudioRoot()
    renderPanel(studio)

    await waitFor(() => expect(screen.getByText('还没有简历')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /新建简历/ }))
    const dialog = await screen.findByRole('dialog', { name: '新建简历' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(6)
  })
})
