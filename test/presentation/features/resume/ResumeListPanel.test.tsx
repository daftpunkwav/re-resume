/**
 * @file ResumeListPanel.test
 * @description The list column: what it shows, what it reports when a row is
 * chosen, and what it asks for before it reports a new resume.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResumeListPanel } from '../../../../src/presentation/features/resume/ResumeListPanel'
import { DRAFT_ID, FROZEN_ID, makeResume } from '../../resumeFixtures'

// React only exposes act() from its development build; a shell that exports

function renderList(
  resumes = [
    makeResume({ id: DRAFT_ID, title: '后端简历' }),
    makeResume({ id: FROZEN_ID, title: '全栈简历', status: 'frozen', targetRole: '全栈工程师' }),
  ],
  selectedResumeId: string | null = DRAFT_ID,
) {
  const onSelect = vi.fn()
  const onCreate = vi.fn()
  render(
    <ResumeListPanel
      resumes={resumes}
      selectedResumeId={selectedResumeId}
      loading={false}
      busy={false}
      onSelect={onSelect}
      onCreate={onCreate}
    />,
  )
  return { onSelect, onCreate }
}

describe('ResumeListPanel', () => {
  it('shows every resume with its status and target role', () => {
    renderList()

    expect(screen.getByText('后端简历')).toBeInTheDocument()
    expect(screen.getByText('草稿')).toBeInTheDocument()
    expect(screen.getByText('全栈简历')).toBeInTheDocument()
    expect(screen.getByText('已定稿')).toBeInTheDocument()
    expect(screen.getByText('全栈工程师')).toBeInTheDocument()
  })

  it('marks the resume the workspace is holding', () => {
    const { container } = render(
      <ResumeListPanel
        resumes={[makeResume({ id: DRAFT_ID, title: '后端简历' })]}
        selectedResumeId={DRAFT_ID}
        loading={false}
        busy={false}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    )

    expect(container.querySelector('.list-row-active')).toHaveTextContent('后端简历')
  })

  it('reports the id of the resume a row names', () => {
    const { onSelect } = renderList()

    fireEvent.click(screen.getByText('全栈简历'))

    expect(onSelect).toHaveBeenCalledWith(FROZEN_ID)
  })

  it('offers the one action that creates a resume when there is none', () => {
    renderList([])

    expect(screen.getByText('还没有简历')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新建简历' }))
    expect(screen.getByRole('dialog', { name: '新建简历' })).toBeInTheDocument()
  })

  it('refuses a resume without a title', () => {
    const { onCreate } = renderList()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(screen.getByText('标题不能为空。')).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('reports the title and the target role the user typed', () => {
    const { onCreate } = renderList()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: ' 数据工程师简历 ' } })
    fireEvent.change(screen.getByLabelText('目标岗位'), { target: { value: '数据工程师' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(onCreate).toHaveBeenCalledWith({ title: '数据工程师简历', targetRole: '数据工程师' })
  })

  it('reports no target role when the field was left empty', () => {
    const { onCreate } = renderList()
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '通用简历' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(onCreate).toHaveBeenCalledWith({ title: '通用简历', targetRole: null })
  })
})
