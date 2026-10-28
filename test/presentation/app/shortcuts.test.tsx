/**
 * @file shortcuts.test
 * @description The one place a key combination is claimed. The intent resolver
 * is pure, so the IME and editable-target rules can be asserted without a
 * listener; the hook itself is checked for dispatch.
 */

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  shortcutForEvent,
  useGlobalShortcuts,
} from '../../../src/presentation/app/shortcuts'

function keyEvent(overrides: Partial<Parameters<typeof shortcutForEvent>[0]>): Parameters<typeof shortcutForEvent>[0] {
  return {
    key: 'n',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    isComposing: false,
    target: document.body,
    ...overrides,
  }
}

function Handlers({
  handlers,
}: {
  readonly handlers: Parameters<typeof useGlobalShortcuts>[0]
}) {
  useGlobalShortcuts(handlers)
  return null
}

describe('shortcutForEvent', () => {
  it('maps the primary modifier combinations the shell implements', () => {
    expect(shortcutForEvent(keyEvent({ key: 'n' }))).toEqual({ kind: 'newConversation' })
    expect(shortcutForEvent(keyEvent({ key: ',' }))).toEqual({ kind: 'toggleSettings' })
    expect(shortcutForEvent(keyEvent({ key: 'B' }))).toEqual({ kind: 'togglePanel' })
    expect(shortcutForEvent(keyEvent({ key: '1' }))).toEqual({
      kind: 'focusDomain',
      domain: 'sidebar',
    })
    expect(shortcutForEvent(keyEvent({ key: '2' }))).toEqual({
      kind: 'focusDomain',
      domain: 'conversation',
    })
    expect(shortcutForEvent(keyEvent({ key: '3' }))).toEqual({
      kind: 'focusDomain',
      domain: 'panel',
    })
    expect(shortcutForEvent(keyEvent({ key: '+' }))).toEqual({ kind: 'scale', direction: 1 })
    expect(shortcutForEvent(keyEvent({ key: '=' }))).toEqual({ kind: 'scale', direction: 1 })
    expect(shortcutForEvent(keyEvent({ key: '-' }))).toEqual({ kind: 'scale', direction: -1 })
    expect(shortcutForEvent(keyEvent({ key: '0' }))).toEqual({ kind: 'resetScale' })
  })

  it('accepts the platform primary modifier', () => {
    expect(shortcutForEvent({ ...keyEvent({ key: 'n' }), ctrlKey: false, metaKey: true })).toEqual(
      { kind: 'newConversation' },
    )
  })

  it('leaves an IME composition alone', () => {
    expect(shortcutForEvent(keyEvent({ isComposing: true }))).toBeNull()
  })

  it('leaves an editable field alone', () => {
    const input = document.createElement('input')
    document.body.append(input)
    try {
      expect(shortcutForEvent(keyEvent({ target: input }))).toBeNull()
    } finally {
      input.remove()
    }
  })

  it('claims nothing without the primary modifier or with Alt held', () => {
    expect(shortcutForEvent(keyEvent({ ctrlKey: false }))).toBeNull()
    expect(shortcutForEvent(keyEvent({ altKey: true }))).toBeNull()
  })

  it('ignores combinations it does not own', () => {
    expect(shortcutForEvent(keyEvent({ key: 'k' }))).toBeNull()
  })
})

describe('useGlobalShortcuts', () => {
  const handlers = {
    newConversation: vi.fn(),
    toggleSettings: vi.fn(),
    togglePanel: vi.fn(),
    focusDomain: vi.fn(),
    adjustScale: vi.fn(),
    resetScale: vi.fn(),
  }

  it('dispatches a mapped combination once', () => {
    handlers.newConversation.mockClear()
    render(<Handlers handlers={handlers} />)

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })

    expect(handlers.newConversation).toHaveBeenCalledTimes(1)
  })

  it('dispatches the focus and scale intents with their argument', () => {
    handlers.focusDomain.mockClear()
    handlers.adjustScale.mockClear()
    render(<Handlers handlers={handlers} />)

    fireEvent.keyDown(window, { key: '3', ctrlKey: true })
    fireEvent.keyDown(window, { key: '+', ctrlKey: true })

    expect(handlers.focusDomain).toHaveBeenCalledWith('panel')
    expect(handlers.adjustScale).toHaveBeenCalledWith(1)
  })

  it('claims nothing while an IME composition is running', () => {
    handlers.newConversation.mockClear()
    render(<Handlers handlers={handlers} />)

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true, isComposing: true })

    expect(handlers.newConversation).not.toHaveBeenCalled()
  })
})
