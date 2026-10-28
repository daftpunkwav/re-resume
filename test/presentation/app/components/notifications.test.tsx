/**
 * @file notifications.test
 * @description Toast and popover: a toast removes itself, a popover is closed
 * by Escape or a click outside and hands focus back to its trigger.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Popover } from '../../../../src/presentation/app/components/Popover'
import { ToastRegion } from '../../../../src/presentation/app/components/Toast'
import {
  MAX_VISIBLE_TOASTS,
  useToastStore,
} from '../../../../src/presentation/app/stores/toastStore'

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastRegion', () => {
  it('shows a toast and removes it after its stay', async () => {
    vi.useFakeTimers()
    render(<ToastRegion />)

    act(() => {
      useToastStore.getState().push('info', '界面缩放已恢复 100%')
    })
    expect(screen.getByRole('status')).toHaveTextContent('界面缩放已恢复 100%')

    // First the visible stay expires, then the exit transition it starts.
    await act(async () => {
      vi.advanceTimersByTime(2400)
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('holds at most three toasts', () => {
    render(<ToastRegion />)

    act(() => {
      for (const message of ['一', '二', '三', '四']) {
        useToastStore.getState().push('info', message)
      }
    })

    expect(useToastStore.getState().toasts).toHaveLength(MAX_VISIBLE_TOASTS)
    expect(screen.queryByText('一')).toBeNull()
    expect(screen.getByText('四')).toBeInTheDocument()
  })
})

describe('Popover', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <Popover open label="模型服务状态" onClose={onClose}>
        <p>尚未配置模型服务</p>
      </Popover>,
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a click outside and stays open on a click inside', async () => {
    const user = userEvent.setup({ delay: null })
    const onClose = vi.fn()
    render(
      <>
        <button type="button">外部按钮</button>
        <Popover open label="模型服务状态" onClose={onClose}>
          <p>尚未配置模型服务</p>
        </Popover>
      </>,
    )

    await user.click(screen.getByText('尚未配置模型服务'))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '外部按钮' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('moves focus into the panel and back to the trigger', () => {
    function Harness() {
      return (
        <>
          <button type="button" onClick={() => undefined}>
            状态
          </button>
          <Popover open label="模型服务状态" onClose={() => undefined}>
            <p>尚未配置模型服务</p>
          </Popover>
        </>
      )
    }
    render(<Harness />)

    expect(screen.getByRole('dialog', { name: '模型服务状态' })).toBe(document.activeElement)
  })
})
