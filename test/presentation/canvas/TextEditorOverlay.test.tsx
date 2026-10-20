/**
 * @file TextEditorOverlay.test
 * @description The editing surface contract: it starts from the block's text,
 * hands a blur's value back as a commit, and lets Escape cancel without a
 * commit racing the blur Escape itself triggers.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TextEditorOverlay } from '../../../src/presentation/canvas/TextEditorOverlay'

const TRANSFORM = { x: 20, y: 30, width: 300, height: 66 }

function renderOverlay(
  overrides: {
    readonly onCommit?: (text: string) => void
    readonly onCancel?: () => void
  } = {},
) {
  const onCommit = overrides.onCommit ?? vi.fn()
  const onCancel = overrides.onCancel ?? vi.fn()
  render(
    <TextEditorOverlay
      initialText="第一段正文"
      transform={TRANSFORM}
      fontSize={16.5}
      lineHeight={24}
      fontFamily="sans-serif"
      onCommit={onCommit}
      onCancel={onCancel}
    />,
  )
  return { onCommit, onCancel }
}

describe('TextEditorOverlay', () => {
  it('opens focused, holding the block text and the drawn geometry', () => {
    renderOverlay()

    const area = screen.getByRole('textbox', { name: '编辑区块文字' })
    expect(area).toHaveValue('第一段正文')
    expect(area).toHaveFocus()
    expect(area).toHaveStyle({ left: '20px', top: '30px', width: '300px', height: '66px' })
  })

  it('commits the typed text on blur', () => {
    const { onCommit } = renderOverlay()

    const area = screen.getByRole('textbox', { name: '编辑区块文字' })
    fireEvent.change(area, { target: { value: '改后的正文' } })
    fireEvent.blur(area)

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('改后的正文')
  })

  it('cancels on Escape and the blur it triggers commits nothing', () => {
    const { onCommit, onCancel } = renderOverlay()

    const area = screen.getByRole('textbox', { name: '编辑区块文字' })
    fireEvent.change(area, { target: { value: '作废的输入' } })
    fireEvent.keyDown(area, { key: 'Escape' })
    fireEvent.blur(area)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('ignores Escape while an IME composition owns the key', () => {
    const { onCommit, onCancel } = renderOverlay()

    const area = screen.getByRole('textbox', { name: '编辑区块文字' })
    // Dismissing a candidate window must not discard the whole session; the
    // blur still commits what the user typed before that candidate.
    fireEvent.keyDown(area, { key: 'Escape', isComposing: true })
    fireEvent.blur(area)

    expect(onCancel).not.toHaveBeenCalled()
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('keeps line breaks the way a resume body needs them', () => {
    const { onCommit } = renderOverlay()

    const area = screen.getByRole('textbox', { name: '编辑区块文字' })
    fireEvent.change(area, { target: { value: '第一行\n第二行' } })
    fireEvent.blur(area)

    expect(onCommit).toHaveBeenCalledWith('第一行\n第二行')
  })
})
