/**
 * @file ExperienceListPanel.test
 * @description Covers the catalog index: grouping by kind, the search that
 * reaches the detail values, the empty library, and a refused deletion that
 * has to name the resume blocks still pointing at the record.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainError } from '../../../../src/domain/shared/DomainError'
import { useNavigation } from '../../../../src/presentation/app/navigationStore'
import { ExperienceWorkspace } from '../../../../src/presentation/features/experience/ExperienceWorkspace'
import {
  createCompositionRootStub,
  createExperienceLibraryStub,
  makeExperience,
  makeVariant,
} from './experienceLibraryStub'

const { rootRef } = vi.hoisted(() => ({ rootRef: { current: null as unknown } }))

vi.mock('../../../../src/presentation/app/ApplicationServicesProvider', () => ({
  useServices: () => rootRef.current,
}))

const EDUCATION = makeExperience({
  id: 'exp-edu',
  kind: 'education',
  title: '某大学',
  organization: '某大学计算机学院',
  detail: { school: '某大学', degree: '学士', major: '计算机', gpa: '3.8' },
  variants: [makeVariant({ id: 'var-edu', label: '课程项目', content: '做过编译器课程设计' })],
})

const PROJECT = makeExperience({
  id: 'exp-proj',
  kind: 'project',
  title: '看板工具',
  organization: '个人项目',
  detail: { technologies: ['TypeScript'], role: '独立开发', highlights: ['日活 200'] },
})

beforeEach(() => {
  useNavigation.setState({ selectedExperienceId: null, selectedResumeId: null })
  rootRef.current = createCompositionRootStub(
    createExperienceLibraryStub({ list: async () => [EDUCATION, PROJECT] }),
  )
})

describe('experience list', () => {
  it('groups the library under a label per kind', async () => {
    render(<ExperienceWorkspace />)

    const educationGroup = await screen.findByRole('heading', { name: '教育经历' })
    const projectGroup = screen.getByRole('heading', { name: '项目经历' })

    expect(within(educationGroup.parentElement as HTMLElement).getByText('某大学')).toBeVisible()
    expect(within(projectGroup.parentElement as HTMLElement).getByText('看板工具')).toBeVisible()
  })

  it('counts the variants and claims of a row', async () => {
    render(<ExperienceWorkspace />)

    const row = (await screen.findByText('某大学')).closest('.list-row') as HTMLElement
    expect(within(row).getByText('1 条表述')).toBeVisible()
    expect(within(row).getByText('0 条断言')).toBeVisible()
  })

  it('filters on the detail values, not only on the title', async () => {
    const user = userEvent.setup()
    render(<ExperienceWorkspace />)
    await screen.findByText('看板工具')

    await user.type(screen.getByLabelText('搜索经历'), 'TypeScript')

    expect(screen.getByText('看板工具')).toBeVisible()
    expect(screen.queryByText('某大学')).toBeNull()
  })

  it('shows the empty state when nothing has been recorded', async () => {
    rootRef.current = createCompositionRootStub(
      createExperienceLibraryStub({ list: async () => [] }),
    )
    render(<ExperienceWorkspace />)

    expect(await screen.findByText('经历库还是空的')).toBeVisible()
  })

  it('names the resume blocks that refuse a deletion', async () => {
    const user = userEvent.setup()
    rootRef.current = createCompositionRootStub(
      createExperienceLibraryStub({
        list: async () => [EDUCATION],
        remove: async () => {
          throw new DomainError(
            'referencedByBlocks',
            'Still referenced.',
            { entity: 'experience', id: 'exp-edu', blockers: ['后端简历 / blk-1', '全栈简历 / blk-2'] },
          )
        },
      }),
    )
    render(<ExperienceWorkspace />)

    await user.click(await screen.findByRole('button', { name: '删除 某大学' }))
    await user.click(screen.getByRole('button', { name: '删除' }))

    expect(await screen.findByText('仍被简历引用，请先在这些简历中解除引用。')).toBeVisible()
    expect(screen.getByText('后端简历 / blk-1')).toBeVisible()
    expect(screen.getByText('全栈简历 / blk-2')).toBeVisible()
  })
})
