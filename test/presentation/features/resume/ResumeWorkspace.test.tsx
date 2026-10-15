/**
 * @file ResumeWorkspace.test
 * @description The region as a whole: which resume the workspace holds, and
 * what happens to that selection when a resume is created or copied.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResumeWorkspace } from '../../../../src/presentation/features/resume/ResumeWorkspace'
import { useNavigation } from '../../../../src/presentation/app/navigationStore'
import type { FakeResumeServices } from '../../fakeResumeServices'
import { createFakeResumeServices } from '../../fakeResumeServices'
import {
  DRAFT_ID,
  FROZEN_ID,
  layOutFixture,
  makeResume,
  materializedOf,
} from '../../resumeFixtures'
import type { DocumentState } from '../../../../src/domain/resume/DocumentChange'
import type { Resume } from '../../../../src/domain/resume/Resume'
import { asResumeId } from '../../../../src/domain/shared/branded-id'

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

function stubWorkbench(initial: readonly Resume[]): FakeResumeServices {
  const services = createFakeResumeServices()
  // The store is mutable because creating and duplicating add to it, and the
  // workspace re-reads the list after each of them.
  const store: Resume[] = [...initial]
  const pageSetup = initial[0]?.pageSetup ?? makeResume().pageSetup
  const stored: DocumentState = { blocks: initial[0]?.blocks ?? [], pageSetup }
  services.resumes.list.mockImplementation(async () => store)
  services.resumes.get.mockImplementation(async (id: string) => store.find((resume) => resume.id === id) ?? null)
  services.resumes.materialize.mockImplementation(async () => stored.blocks.map(materializedOf))
  services.resumes.layOut.mockImplementation((blocks, page) => layOutFixture(blocks, page))
  services.resumes.create.mockImplementation(async (request: { title: string; targetRole: string | null }) => {
    const created = makeResume({ id: asResumeId('resume-created'), title: request.title, targetRole: request.targetRole })
    store.push(created)
    return created.id
  })
  services.resumes.duplicate.mockImplementation(async () => {
    const copy = makeResume({ id: asResumeId('resume-copy'), title: '后端简历（副本）' })
    store.push(copy)
    return copy.id
  })
  services.resumes.commit.mockImplementation(async () => ({ seq: 2, label: '测试', state: stored }))
  services.experiences.list.mockResolvedValue([])
  servicesRef.current = services
  return services
}

const DRAFTS = [
  makeResume({ id: DRAFT_ID, title: '后端简历' }),
  makeResume({ id: FROZEN_ID, title: '全栈简历', status: 'frozen' }),
]

describe('ResumeWorkspace', () => {
  beforeEach(() => {
    useNavigation.setState({ selectedResumeId: null })
  })

  it('takes the first resume when nothing is selected yet', async () => {
    stubWorkbench(DRAFTS)
    render(<ResumeWorkspace />)

    await waitFor(() => expect(useNavigation.getState().selectedResumeId).toBe(DRAFT_ID))
    expect(await screen.findByRole('heading', { name: '后端简历' })).toBeInTheDocument()
  })

  it('moves the selection when another row is chosen', async () => {
    stubWorkbench(DRAFTS)
    render(<ResumeWorkspace />)
    await screen.findByRole('heading', { name: '后端简历' })

    fireEvent.click(screen.getByText('全栈简历'))

    await waitFor(() => expect(useNavigation.getState().selectedResumeId).toBe(FROZEN_ID))
    expect(await screen.findByText('已定稿，复制一份草稿继续修改')).toBeInTheDocument()
  })

  it('creates a resume and selects it', async () => {
    const services = stubWorkbench(DRAFTS)
    render(<ResumeWorkspace />)
    await screen.findByRole('heading', { name: '后端简历' })

    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '数据简历' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    await waitFor(() =>
      expect(services.resumes.create).toHaveBeenCalledWith({ title: '数据简历', targetRole: null }),
    )
    await waitFor(() => expect(useNavigation.getState().selectedResumeId).toBe('resume-created'))
  })

  it('reports a creation that was refused instead of leaving a blank window', async () => {
    const services = stubWorkbench(DRAFTS)
    services.resumes.create.mockRejectedValue(new Error('本地数据还没有准备好。'))
    render(<ResumeWorkspace />)
    await screen.findByRole('heading', { name: '后端简历' })

    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '数据简历' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(await screen.findByText('本地数据还没有准备好。')).toBeInTheDocument()
    expect(useNavigation.getState().selectedResumeId).toBe(DRAFT_ID)
  })

  it('copies the selected resume and follows the copy', async () => {
    const services = stubWorkbench(DRAFTS)
    render(<ResumeWorkspace />)
    await screen.findByRole('heading', { name: '后端简历' })

    const header = screen.getByRole('heading', { name: '后端简历' }).closest('.resume-editor')
    fireEvent.click(within(header as HTMLElement).getByRole('button', { name: '复制' }))

    await waitFor(() =>
      expect(services.resumes.duplicate).toHaveBeenCalledWith({ sourceResumeId: DRAFT_ID }),
    )
    await waitFor(() => expect(useNavigation.getState().selectedResumeId).toBe('resume-copy'))
  })

  it('offers nothing to edit until a resume is selected', async () => {
    stubWorkbench([])
    render(<ResumeWorkspace />)

    expect(await screen.findByText('还没有简历')).toBeInTheDocument()
    expect(screen.getByText('选择一份简历')).toBeInTheDocument()
  })
})
