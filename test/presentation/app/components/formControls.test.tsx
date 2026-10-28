/**
 * @file formControls.test
 * @description Switch, segmented control and slider: the three preference
 * controls of the settings overlay, each with the keyboard contract its role
 * promises.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Kbd, ShortcutKeys } from '../../../../src/presentation/app/components/Kbd'
import { SegmentedControl } from '../../../../src/presentation/app/components/SegmentedControl'
import { Slider } from '../../../../src/presentation/app/components/Slider'
import { Switch } from '../../../../src/presentation/app/components/Switch'

const SCHEMES = [
  { id: 'system' as const, label: '跟随系统' },
  { id: 'light' as const, label: '浅色' },
  { id: 'dark' as const, label: '深色' },
]

describe('Switch', () => {
  it('reports its state and toggles on activation', async () => {
    const user = userEvent.setup({ delay: null })
    const onChange = vi.fn()
    render(
      <Switch label="减少界面动效" description="关闭位移动画。" checked={false} onChange={onChange} />,
    )

    const control = screen.getByRole('switch', { name: '减少界面动效' })
    expect(control).toHaveAttribute('aria-checked', 'false')
    expect(control).toHaveAccessibleDescription('关闭位移动画。')

    await user.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('can be disabled', () => {
    render(<Switch label="减少界面动效" checked={false} onChange={() => undefined} disabled />)
    expect(screen.getByRole('switch', { name: '减少界面动效' })).toBeDisabled()
  })
})

describe('SegmentedControl', () => {
  it('is a radio group with one checked option', () => {
    render(
      <SegmentedControl label="外观模式" options={SCHEMES} value="light" onChange={() => undefined} />,
    )

    const group = screen.getByRole('radiogroup', { name: '外观模式' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: '浅色' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '浅色' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: '深色' })).toHaveAttribute('tabindex', '-1')
  })

  it('selects the neighbouring option with the arrow keys', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl label="外观模式" options={SCHEMES} value="light" onChange={onChange} />,
    )

    fireEvent.keyDown(screen.getByRole('radio', { name: '浅色' }), { key: 'ArrowRight' })

    expect(onChange).toHaveBeenCalledWith('dark')
  })

  it('selects an option when it is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    const onChange = vi.fn()
    render(
      <SegmentedControl label="外观模式" options={SCHEMES} value="light" onChange={onChange} />,
    )

    await user.click(screen.getByRole('radio', { name: '跟随系统' }))
    expect(onChange).toHaveBeenCalledWith('system')
  })
})

describe('Slider', () => {
  it('exposes its value in words and reports a change', () => {
    const onChange = vi.fn()
    render(
      <Slider
        label="界面缩放"
        value={1}
        min={0.8}
        max={1.4}
        step={0.1}
        onChange={onChange}
        formatValue={(value) => `${Math.round(value * 100)}%`}
        description="快捷键也可以调整。"
      />,
    )

    const slider = screen.getByLabelText('界面缩放')
    expect(slider).toHaveAttribute('aria-valuetext', '100%')
    expect(slider).toHaveAccessibleDescription('快捷键也可以调整。')

    fireEvent.change(slider, { target: { value: '1.2' } })
    expect(onChange).toHaveBeenCalledWith(1.2)
  })
})

describe('Kbd and ShortcutKeys', () => {
  it('renders one cap per key with a separator', () => {
    const { container } = render(<ShortcutKeys keys={['Ctrl', 'N']} />)

    expect(screen.getAllByText('Ctrl')).toHaveLength(1)
    expect(container.querySelectorAll('kbd')).toHaveLength(2)
    expect(screen.getByText('+')).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders a single cap', () => {
    render(<Kbd>Esc</Kbd>)
    expect(screen.getByText('Esc').tagName).toBe('KBD')
  })
})
