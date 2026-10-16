/**
 * @file BlockPalette.test
 * @description The experience block control: which confirmed variants it offers,
 * and what happens to a choice the library no longer holds.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BlockPalette } from '../../../../src/presentation/features/resume/BlockPalette'
import {
  createExperienceLibraryStub,
  makeExperience,
  makeVariant,
} from '../experience/experienceLibraryStub'
import type { Experience } from '../../../../src/domain/catalog/Experience'

const { rootRef } = vi.hoisted(() => ({ rootRef: { current: null as unknown } }))

vi.mock('../../../../src/presentation/app/ApplicationServicesProvider', () => ({
  useServices: () => rootRef.current,
}))

function libraryWith(...variantIds: readonly string[]): Experience {
  return makeExperience({
    id: 'exp-one',
    kind: 'project',
    title: '看板工具',
    variants: variantIds.map((id) =>
      makeVariant({ id, label: id === 'var-arch' ? '架构导向' : '业务导向', content: `${id} 的正文。` }),
    ),
  })
}

/** Points the root at a library that will answer with `experiences`. */
function givenLibrary(experiences: readonly Experience[]): void {
  let counter = 0
  rootRef.current = {
    experiences: createExperienceLibraryStub({ list: async () => experiences }),
    ids: { next: () => `blk-${(counter += 1)}` },
  }
}

/**
 * The palette reads the library through the root, so swapping it is only
 * visible on the next render. `重新读取` is that render.
 */
function renderPalette(): { onAddBlock: ReturnType<typeof vi.fn> } {
  const onAddBlock = vi.fn()
  function Harness() {
    const [, redraw] = useReducer((renders: number) => renders + 1, 0)
    return (
      <>
        <button type="button" onClick={redraw}>
          重新读取
        </button>
        <BlockPalette disabled={false} onAddBlock={onAddBlock} />
      </>
    )
  }
  render(<Harness />)
  return { onAddBlock }
}

describe('BlockPalette', () => {
  it('offers only confirmed variants', async () => {
    givenLibrary([
      makeExperience({
        id: 'exp-one',
        kind: 'project',
        title: '看板工具',
        variants: [
          makeVariant({ id: 'var-arch', label: '架构导向', content: '主导架构重写。' }),
          makeVariant({ id: 'var-draft', label: '草稿', content: '未定稿。', confirmedAt: null }),
        ],
      }),
    ])
    renderPalette()

    expect(await screen.findByRole('option', { name: '看板工具 · 架构导向' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '看板工具 · 草稿' })).toBeNull()
    expect(screen.getByLabelText('经历表述')).toHaveValue('exp-one::var-arch')
  })

  it('keeps a chosen variant while the library still offers it', async () => {
    const user = userEvent.setup()
    givenLibrary([libraryWith('var-arch', 'var-sell')])
    renderPalette()

    await user.selectOptions(await screen.findByLabelText('经历表述'), 'exp-one::var-sell')

    expect(screen.getByLabelText('经历表述')).toHaveValue('exp-one::var-sell')
  })

  it('falls back to the first variant when the chosen one is withdrawn', async () => {
    const user = userEvent.setup()
    givenLibrary([libraryWith('var-arch', 'var-sell')])
    const { onAddBlock } = renderPalette()

    await user.selectOptions(await screen.findByLabelText('经历表述'), 'exp-one::var-sell')

    // The library moves under the form: the chosen variant is no longer
    // confirmed, so it is no longer one of the options.
    givenLibrary([libraryWith('var-arch')])
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    await screen.findByRole('option', { name: '看板工具 · 架构导向' })

    expect(screen.getByLabelText('经历表述')).toHaveValue('exp-one::var-arch')

    await user.click(screen.getByRole('button', { name: '添加经历区块' }))

    expect(onAddBlock).toHaveBeenCalledTimes(1)
    expect(onAddBlock.mock.calls[0]?.[0].content).toMatchObject({
      type: 'experience',
      experienceId: 'exp-one',
      variantId: 'var-arch',
    })
  })
})
