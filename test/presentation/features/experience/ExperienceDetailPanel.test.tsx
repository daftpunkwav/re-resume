/**
 * @file ExperienceDetailPanel.test
 * @description Covers the open experience: the facts form in both directions,
 * a refused command reported as text instead of an unhandled rejection, a
 * variant confirmation that changes the row, and the claim actions the
 * lifecycle actually offers.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import { DomainError } from '../../../../src/domain/shared/DomainError'
import { useNavigation } from '../../../../src/presentation/app/navigationStore'
import { ExperienceWorkspace } from '../../../../src/presentation/features/experience/ExperienceWorkspace'
import {
  createCompositionRootStub,
  createExperienceLibraryStub,
  makeClaim,
  makeExperience,
  makeVariant,
  rejectedDetail,
  refusedCommand,
} from './experienceLibraryStub'
import type { ExperienceLibrary } from '../../../../src/bootstrap/compositionRoot'

const { rootRef } = vi.hoisted(() => ({ rootRef: { current: null as unknown } }))

vi.mock('../../../../src/presentation/app/ApplicationServicesProvider', () => ({
  useServices: () => rootRef.current,
}))

const PROJECT = makeExperience({
  id: 'exp-proj',
  kind: 'project',
  title: '看板工具',
  organization: '个人项目',
  detail: { technologies: ['TypeScript'], role: '独立开发', highlights: ['日活 200'] },
})

const DRAFTED = makeExperience({
  id: 'exp-proj',
  kind: 'project',
  title: '看板工具',
  detail: {},
  variants: [
    makeVariant({
      id: 'var-draft',
      label: '架构导向',
      content: '主导了前端架构重写。\n第二行不进入摘要。',
      draftedByRunId: 'run-7',
      confirmedAt: null,
    }),
  ],
  claims: [
    makeClaim({ id: 'clm-pending', kind: 'metric', statement: '日活 200' }),
    makeClaim({
      id: 'clm-rejected',
      kind: 'metric',
      statement: '日活 2000',
      status: 'rejected',
    }),
  ],
})

function givenLibrary(overrides: Partial<ExperienceLibrary>): void {
  rootRef.current = createCompositionRootStub(createExperienceLibraryStub(overrides))
}

async function openRow(title: string): Promise<void> {
  const row = (await screen.findByText(title)).closest('button')
  expect(row).not.toBeNull()
  await userEvent.setup().click(row as HTMLButtonElement)
}

beforeEach(() => {
  useNavigation.setState({ selectedExperienceId: null, selectedResumeId: null })
})

describe('experience detail', () => {
  it('shows the facts of the selected experience', async () => {
    givenLibrary({ list: async () => [PROJECT], get: async () => PROJECT })
    render(<ExperienceWorkspace />)

    await openRow('看板工具')

    expect(await screen.findByLabelText('标题')).toHaveValue('看板工具')
    expect(screen.getByLabelText('角色')).toHaveValue('独立开发')
    expect(screen.getByLabelText('技术栈')).toHaveValue('TypeScript')
    expect(screen.getByLabelText('亮点')).toHaveValue('日活 200')
  })

  it('explains what to do when no experience is selected', async () => {
    givenLibrary({ list: async () => [PROJECT], get: async () => PROJECT })
    render(<ExperienceWorkspace />)

    expect(await screen.findByText('选择一条经历')).toBeVisible()
  })

  it('leaves the create form when a listed experience is chosen', async () => {
    const user = userEvent.setup()
    givenLibrary({ list: async () => [PROJECT], get: async () => PROJECT })
    render(<ExperienceWorkspace />)

    await user.click(await screen.findByRole('button', { name: '新建经历' }))
    expect(await screen.findByRole('button', { name: '创建经历' })).toBeVisible()

    await openRow('看板工具')

    expect(screen.queryByRole('button', { name: '创建经历' })).toBeNull()
    expect(await screen.findByLabelText('角色')).toHaveValue('独立开发')
  })

  it('cancels out of the create form without saving anything', async () => {
    const user = userEvent.setup()
    const create = vi.fn()
    givenLibrary({ list: async () => [], create })
    render(<ExperienceWorkspace />)

    await user.click(await screen.findByRole('button', { name: '新建经历' }))
    await user.type(await screen.findByLabelText('标题'), '前端工程师')
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('button', { name: '创建经历' })).toBeNull()
    expect(await screen.findByText('选择一条经历')).toBeVisible()
    expect(create).not.toHaveBeenCalled()
  })

  it('reports a refused create as a message on the form', async () => {
    const user = userEvent.setup()
    givenLibrary({
      list: async () => [],
      create: async () => refusedCommand(rejectedDetail('work', {})),
    })
    render(<ExperienceWorkspace />)

    await user.click(await screen.findByRole('button', { name: '新建经历' }))
    await user.type(await screen.findByLabelText('标题'), '前端工程师')
    await user.click(screen.getByRole('button', { name: '创建经历' }))

    expect(await screen.findByText(/^公司：/)).toBeVisible()
  })

  it('reports a refused fact edit as a message on the form', async () => {
    const user = userEvent.setup()
    givenLibrary({
      list: async () => [PROJECT],
      get: async () => PROJECT,
      updateFact: async () =>
        refusedCommand(rejectedDetail('project', { technologies: [], highlights: [] })),
    })
    render(<ExperienceWorkspace />)
    await openRow('看板工具')

    const title = await screen.findByLabelText('标题')
    await user.clear(title)
    await user.type(title, '看板工具 Pro')
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    expect(await screen.findByText(/^角色：/)).toBeVisible()
  })

  it('does not file one experience under another when the selection moves mid-command', async () => {
    const user = userEvent.setup()
    const release: { current: (() => void) | null } = { current: null }
    let listReads = 0
    const slow = makeExperience({
      id: 'exp-slow',
      kind: 'project',
      title: '慢的那条',
      detail: { technologies: ['TypeScript'], role: '慢', highlights: ['慢'] },
      variants: [
        makeVariant({
          id: 'var-slow',
          label: '慢表述',
          content: '慢的正文。',
          draftedByRunId: 'run-9',
          confirmedAt: null,
        }),
      ],
    })
    const fast = makeExperience({
      id: 'exp-fast',
      kind: 'project',
      title: '快的那条',
      detail: { technologies: ['Go'], role: '快', highlights: ['快'] },
    })
    givenLibrary({
      list: async () => {
        listReads += 1
        return [slow, fast]
      },
      get: async (id: unknown) => (String(id) === 'exp-slow' ? slow : fast),
      confirmVariant: async () => {
        // Still running when the user picks the other row.
        await new Promise<void>((resolve) => {
          release.current = resolve
        })
        return {
          ...slow,
          variants: [
            {
              ...slow.variants[0]!,
              confirmedAt: parseDateTime('2026-03-02T09:00:00.000Z') as DateTime,
            },
          ],
        }
      },
    })
    render(<ExperienceWorkspace />)

    await openRow('慢的那条')
    await user.click(screen.getByRole('tab', { name: '表述' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))

    await openRow('快的那条')
    expect(await screen.findByLabelText('角色')).toHaveValue('快')

    const readsBefore = listReads
    release.current?.()
    // Wait for the command to have run all the way through — it refreshes the
    // library last. Waiting for the old variant's text to be absent would pass
    // at once, since choosing the other row had already removed it.
    await waitFor(() => expect(listReads).toBeGreaterThan(readsBefore))

    // The confirmation belonged to the other experience, and the panel it was
    // started in is gone: nothing it returns may reach the row now open, which
    // also opens on its own tab rather than the one it was showing.
    expect(screen.getByLabelText('角色')).toHaveValue('快')
    expect(screen.getByLabelText('标题')).toHaveValue('快的那条')
    expect(screen.getByRole('tab', { name: '基本信息' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('慢的正文。')).toBeNull()
  })

  it('clears the draft badge once a variant is confirmed', async () => {
    const user = userEvent.setup()
    givenLibrary({
      list: async () => [DRAFTED],
      get: async () => DRAFTED,
      confirmVariant: async () => ({
        ...DRAFTED,
        variants: [
          { ...DRAFTED.variants[0]!, confirmedAt: parseDateTime('2026-03-02T09:00:00.000Z') as DateTime },
        ],
      }),
    })
    render(<ExperienceWorkspace />)
    await openRow('看板工具')

    await user.click(screen.getByRole('tab', { name: '表述' }))
    expect(await screen.findByText('未确认')).toBeVisible()
    expect(screen.getByText('主导了前端架构重写。')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '确认' }))

    await screen.findByRole('button', { name: '编辑' })
    expect(screen.queryByText('未确认')).toBeNull()
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull()
  })

  it('offers reopening only on a rejected claim', async () => {
    const user = userEvent.setup()
    givenLibrary({ list: async () => [DRAFTED], get: async () => DRAFTED })
    render(<ExperienceWorkspace />)
    await openRow('看板工具')

    await user.click(screen.getByRole('tab', { name: '断言' }))

    expect(await screen.findByText('待确认')).toBeVisible()
    expect(screen.getByText('已拒绝')).toBeVisible()
    expect(screen.getAllByRole('button', { name: '确认' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '拒绝' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '重新开启' })).toHaveLength(1)
  })

  it('names the resume blocks that refuse a variant deletion', async () => {
    const user = userEvent.setup()
    givenLibrary({
      list: async () => [DRAFTED],
      get: async () => DRAFTED,
      removeVariant: async () => {
        throw new DomainError('referencedByBlocks', 'Still referenced.', {
          entity: 'variant',
          id: 'var-draft',
          blockers: ['后端简历 / blk-9'],
        })
      },
    })
    render(<ExperienceWorkspace />)
    await openRow('看板工具')

    await user.click(screen.getByRole('tab', { name: '表述' }))
    await user.click(await screen.findByRole('button', { name: '删除' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    expect(await screen.findByText('仍被简历引用，请先在这些简历中解除引用。')).toBeVisible()
    expect(screen.getByText('后端简历 / blk-9')).toBeVisible()
  })
})
