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

/**
 * `busy` arrives on the second render rather than at mount, so a dialog that
 * is only ever busy after a click still exercises the guard.
 */
function BusyHarness() {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <button type="button" onClick={() => setBusy(true)}>
        开始
      </button>
      <Dialog
        open={open}
        title="定稿这份简历"
        busy={busy}
        onConfirm={() => undefined}
        onClose={() => setOpen(false)}
      />
    </div>
  )
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

describe('dialog dismissal while busy', () => {
  it('ignores Escape, the scrim and the close button while an operation runs', async () => {
    const user = userEvent.setup()
    render(<BusyHarness />)
    const dialog = screen.getByRole('dialog')

    // The operation starts after the dialog opened, so the guard has to be
    // read at the moment it fires rather than captured when it mounted.
    await user.click(screen.getByRole('button', { name: '开始' }))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBe(dialog)

    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(screen.getByRole('dialog')).toBe(dialog)

    // Every way out is closed, so nothing the caller renders inside to report
    // the result can be unmasked by a stray dismissal.
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(screen.getByRole('dialog')).toBe(dialog)
  })

  it('dismisses again once the operation is no longer pending', async () => {
    const user = userEvent.setup()
    render(<BusyHarness />)

    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
