/**
 * @file Dialog.test
 * @description The keyboard contract of a modal: focus enters it once, Tab
 * cannot walk out into the page behind it, and closing hands focus back.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Dialog } from '../../../../src/presentation/app/components/Dialog'

/**
 * `rerender` changes no prop but state, so a child that keys its focus effect
 * on the callback identity re-runs on it — which is what a real parent does
 * whenever anything above it re-renders.
 */
function Harness() {
  const [open, setOpen] = useState(false)
  const [renders, setRenders] = useState(0)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <button type="button" onClick={() => setRenders((count) => count + 1)}>
        重新渲染
      </button>
      <span data-testid="renders">{renders}</span>
      <Dialog
        open={open}
        title="定稿这份简历"
        onConfirm={() => undefined}
        onClose={() => setOpen(false)}
      >
        <input aria-label="备注" />
      </Dialog>
    </div>
  )
}

function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  return user.click(screen.getByRole('button', { name: '打开' }))
}

describe('dialog focus', () => {
  it('leaves focus where it is when the parent re-renders', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openDialog(user)

    const note = screen.getByLabelText('备注')
    await user.click(note)
    expect(document.activeElement).toBe(note)

    // fireEvent keeps the focus where it is; a click would move it itself.
    fireEvent.click(screen.getByRole('button', { name: '重新渲染' }))

    expect(screen.getByTestId('renders').textContent).toBe('1')
    expect(document.activeElement).toBe(note)
  })

  it('wraps Tab from the last control back to the first', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openDialog(user)

    screen.getByRole('button', { name: '确定' }).focus()
    await user.tab()

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭' }))
  })

  it('wraps Shift+Tab from the first control back to the last', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openDialog(user)

    screen.getByRole('button', { name: '关闭' }).focus()
    await user.tab({ shift: true })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '确定' }))
  })

  it('gives focus back to the control that opened it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '打开' })
    await user.click(opener)

    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
