/**
 * @file buttons.test
 * @description The state matrix of the two button primitives: loading keeps
 * the width and reports itself busy, an icon-only button requires a name, and
 * a toggle reports its pressed state.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '../../../../src/presentation/app/components/Button'
import { IconButton } from '../../../../src/presentation/app/components/IconButton'

describe('Button', () => {
  it('renders its label and fires exactly once', async () => {
    const user = userEvent.setup({ delay: null })
    const onClick = vi.fn()
    render(<Button onClick={onClick}>保存</Button>)

    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is busy and not clickable while loading', async () => {
    const user = userEvent.setup({ delay: null })
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        保存
      </Button>,
    )

    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is not clickable while disabled', async () => {
    const user = userEvent.setup({ delay: null })
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        保存
      </Button>,
    )

    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('IconButton', () => {
  it('carries the accessible name it is given', () => {
    render(<IconButton icon="settings" label="打开设置" showTooltip={false} />)

    expect(screen.getByRole('button', { name: '打开设置' })).toBeInTheDocument()
  })

  it('reports its pressed state when it is a toggle', () => {
    render(<IconButton icon="id-card" label="简历信息面板" pressed showTooltip={false} />)

    expect(screen.getByRole('button', { name: '简历信息面板' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows the same words in the tooltip as in the accessible name', () => {
    const { container } = render(<IconButton icon="settings" label="打开设置" />)

    const tooltip = container.querySelector('.tooltip')
    expect(tooltip).toHaveAttribute('data-tooltip', '打开设置')
  })

  it('shows the bubble on hover and hides it again on leave', () => {
    const { container } = render(<IconButton icon="settings" label="打开设置" />)

    const tooltip = container.querySelector('.tooltip') as HTMLElement
    fireEvent.pointerEnter(tooltip)
    expect(tooltip).toHaveAttribute('data-visible')

    fireEvent.pointerLeave(tooltip)
    expect(tooltip).not.toHaveAttribute('data-visible')
  })

  it('hides the bubble as soon as the control is pressed', () => {
    const { container } = render(<IconButton icon="settings" label="打开设置" />)
    const tooltip = container.querySelector('.tooltip') as HTMLElement

    fireEvent.pointerEnter(tooltip)
    fireEvent.pointerDown(tooltip.querySelector('button') as HTMLButtonElement)

    expect(tooltip).not.toHaveAttribute('data-visible')
  })
})
