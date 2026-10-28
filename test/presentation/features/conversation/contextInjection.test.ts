/**
 * @file contextInjection.test
 * @description The two "add to conversation" actions: the chip the composer
 * receives, the label it shows, the focus request, and the duplicate case.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  addEntryToConversation,
  entryContextLabel,
} from '../../../../src/presentation/features/conversation/contextInjection'
import { addResumeToConversation } from '../../../../src/presentation/features/conversation/contextInjection'
import { useConversationStore } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import { useInfoStore } from '../../../../src/presentation/features/info/stores/infoStore'
import { useToastStore } from '../../../../src/presentation/app/stores/toastStore'
import type { InfoEntry } from '../../../../src/domain/info/InfoEntry'
import type { Resume } from '../../../../src/domain/resume/Resume'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import { asInfoEntryId, asResumeId } from '../../../../src/domain/shared/branded-id'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

const ENTRY: InfoEntry = {
  id: asInfoEntryId('entry-1'),
  moduleKind: 'project',
  customModuleId: null,
  title: '订单中台重构',
  fields: {},
  sortOrder: 1,
  origin: 'user',
  sourceRunId: null,
  createdAt: AT,
  updatedAt: AT,
}

function resetComposer(): void {
  useConversationStore.setState({
    composer: { text: '', contexts: [], attachments: [] },
    composerFocusRequest: 0,
  })
}

beforeEach(() => {
  resetComposer()
  useToastStore.setState({ toasts: [] })
  useInfoStore.setState({ customModules: [] })
})

afterEach(() => {
  resetComposer()
})

describe('context injection', () => {
  it('adds an entry chip with its module label and focuses the composer', () => {
    addEntryToConversation(ENTRY)

    const store = useConversationStore.getState()
    expect(store.composer.contexts).toEqual([
      { context: { kind: 'entry', refId: 'entry-1' }, label: expect.stringContaining('订单中台重构') },
    ])
    expect(store.composerFocusRequest).toBe(1)
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('订单中台重构')
  })

  it('adds the resume chip with its title', () => {
    addResumeToConversation({ id: asResumeId('resume-1'), title: '前端实习简历' } as Resume)

    expect(useConversationStore.getState().composer.contexts).toEqual([
      { context: { kind: 'resume', refId: asResumeId('resume-1') }, label: '简历：前端实习简历' },
    ])
  })

  it('does not add a chip that is already attached', () => {
    useConversationStore.setState({
      composer: {
        text: '继续',
        contexts: [
          {
            context: { kind: 'entry', refId: asInfoEntryId('entry-1') },
            label: '项目经验：订单中台重构',
          },
        ],
        attachments: [],
      },
    })

    addEntryToConversation(ENTRY)

    expect(useConversationStore.getState().composer.contexts).toHaveLength(1)
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('已经在本轮上下文里')
  })
})

describe('entry context label', () => {
  it('names the built-in module', () => {
    expect(entryContextLabel(ENTRY)).toContain('订单中台重构')
    expect(entryContextLabel(ENTRY)).toContain('项目')
  })
})
