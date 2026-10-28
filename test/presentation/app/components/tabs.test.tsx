/**
 * @file tabs.test
 * @description The tab list used by the dock header: one tab stop, arrow keys
 * move the selection, and the panel is labelled by the selected tab.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Tabs } from '../../../../src/presentation/app/components/Tabs'

const TABS = [
  { id: 'resume', label: '简历创作' },
  { id: 'info', label: '简历信息' },
] as const

function Harness() {
  const [active, setActive] = useState<'resume' | 'info'>('resume')
  return (
    <Tabs tabs={TABS} active={active} onChange={setActive} label="面板切换">
      <p>{active === 'resume' ? '创作面板' : '信息面板'}</p>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('is a tab list with one tab stop', () => {
    render(
      <Tabs tabs={TABS} active="resume" onChange={vi.fn()} label="面板切换">
        <p>内容</p>
      </Tabs>,
    )

    expect(screen.getByRole('tablist', { name: '面板切换' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '简历创作' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '简历创作' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: '简历信息' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('内容')
  })

  it('moves the selection with the arrow keys', () => {
    render(<Harness />)

    fireEvent.keyDown(screen.getByRole('tab', { name: '简历创作' }), { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: '简历信息' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('信息面板')
  })

  it('selects a tab on click', async () => {
    const user = userEvent.setup({ delay: null })
    render(<Harness />)

    await user.click(screen.getByRole('tab', { name: '简历信息' }))

    expect(screen.getByRole('tabpanel')).toHaveTextContent('信息面板')
  })
})
