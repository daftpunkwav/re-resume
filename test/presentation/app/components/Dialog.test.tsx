/**
 * @file Dialog.test
 * @description The keyboard contract of a modal: focus enters it once, Tab
 * cannot walk out into the page behind it, closing hands focus back, and the
 * element that holds focus says so.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Dialog } from '../../../../src/presentation/app/components/Dialog'

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..')

/**
 * The stylesheet is loaded into the document so the focus indicator is read
 * the way a browser reads it: jsdom applies the cascade to the properties it
 * models, and the outline longhands are among them.
 */
const stylesheet = document.createElement('style')
stylesheet.textContent = readFileSync(
  join(REPOSITORY_ROOT, 'src/presentation/app/components/components.css'),
  'utf8',
)
document.head.append(stylesheet)

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

/** Opens the dialog of the harness the way a user would. */
function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  return user.click(screen.getByRole('button', { name: '打开' }))
}

/** The rule the loaded stylesheet declares for one selector. */
function ruleFor(selector: string): CSSStyleRule | null {
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText === selector) return rule
    }
  }
  return null
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
  /**
   * The panel is the element that holds the focus, so it is the element that
   * has to show the indicator.
   */
  it('shows a focus indicator on the panel that holds focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openDialog(user)

    const panel = screen.getByRole('dialog')
    // The panel is the focus target until the first Tab, so it is the element
    // that has to carry the indicator.
    expect(document.activeElement).toBe(panel)

    // The rule the stylesheet declares for the focused panel. jsdom keeps the
    // outline declaration but does not apply the shorthand to the computed
    // style, so the indicator is read from the rule itself.
    const indicator = ruleFor('.dialog:focus')?.style.getPropertyValue('outline')
    expect(indicator).not.toBe('')
    expect(indicator).not.toBe('none')
    // The ring is drawn in the accent colour of the theme, so a rename of that
    // token fails here instead of leaving the panel without a ring.
    expect(indicator).toContain('var(--accent)')
    // The offset reaches the focused element, which is what proves the rule
    // applies to this panel and not to some other selector. The browser
    // project reads the resolved 2px; jsdom keeps the token as written.
    expect(ruleFor('.dialog:focus')?.style.getPropertyValue('outline-offset')).toBe(
      'var(--focus-ring-offset)',
    )
  })

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
