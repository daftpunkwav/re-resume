/**
 * @file lastOpenedConversation.test
 * @description The window-continuity store: a recorded session round-trips, an
 * empty entry reads as no preference, and a storage that refuses both
 * operations degrades to "not remembered" instead of failing the boot.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { asConversationId } from '../../../src/domain/shared/branded-id'
import {
  BrowserLastOpenedConversationStore,
  LAST_OPENED_CONVERSATION_KEY,
} from '../../../src/infrastructure/platform/lastOpenedConversation'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('BrowserLastOpenedConversationStore', () => {
  it('round-trips the session it records', () => {
    const store = new BrowserLastOpenedConversationStore()
    expect(store.read()).toBeNull()

    store.write(asConversationId('conversation-7'))

    expect(window.localStorage.getItem(LAST_OPENED_CONVERSATION_KEY)).toBe('conversation-7')
    expect(store.read()).toBe('conversation-7')
  })

  it('reads a blank entry as no preference', () => {
    const store = new BrowserLastOpenedConversationStore()
    window.localStorage.setItem(LAST_OPENED_CONVERSATION_KEY, '   ')

    expect(store.read()).toBeNull()
  })

  it('survives a storage that refuses to read', () => {
    const store = new BrowserLastOpenedConversationStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })

    expect(store.read()).toBeNull()
  })

  it('drops a write the storage refuses', () => {
    const store = new BrowserLastOpenedConversationStore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied')
    })

    expect(() => store.write(asConversationId('conversation-8'))).not.toThrow()
  })
})
