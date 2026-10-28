/**
 * @file conversationList.test
 * @description The sidebar session list: pinned-first grouping, the hover
 * actions, inline rename, pin and the delete confirmation.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ConversationList, groupSections } from '../../../../src/presentation/features/conversation/ConversationList'
import { useConversationStore } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import type { ConversationServices } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import { createConversationService } from '../../../../src/bootstrap/wiring/conversation'
import { createInfoService } from '../../../../src/bootstrap/wiring/info'
import { createAppSettingsService } from '../../../../src/bootstrap/wiring/appSettings'
import { ActiveRunRegistry } from '../../../../src/application/generation/activeRunRegistry'
import { ResumeEntryReferences } from '../../../../src/infrastructure/persistence/resume/ResumeEntryReferences'
import {
  InMemoryChangeLogRepository,
  InMemoryCustomModuleRepository,
  InMemoryEntryReferenceQuery,
  InMemoryInfoEntryRepository,
} from '../../../../src/infrastructure/preview/inMemoryInfoRepositories'
import { InMemoryAppSettingsRepository } from '../../../../src/infrastructure/preview/inMemoryRepositories'
import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import type { Conversation } from '../../../../src/domain/conversation/Conversation'
import type { ConversationGroups } from '../../../../src/application/conversation/listConversations'
import { createConversationBed } from '../../../support/conversationBed'
import type { ConversationBed } from '../../../support/conversationBed'
import { FixedBytesPdfExporter, RecordingPdfFileSaver } from '../../../support/pdfDoubles'
import { FixedClock, SequentialIdGenerator } from '../../../support/fakeEnvironment'

async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

interface Harness {
  readonly bed: ConversationBed
  readonly services: ConversationServices
}

function createHarness(): Harness {
  const bed = createConversationBed()
  const conversation = createConversationService({
    repositories: {
      conversations: bed.conversations,
      messages: bed.messages,
      messageContexts: bed.messageContexts,
      attachments: bed.attachments,
      jobPostings: bed.jobPostings,
      runs: bed.runs,
      invocations: bed.invocations,
      fileStore: bed.fileStore,
    },
    library: {
      entries: bed.entries,
      customModules: bed.customModules,
      references: new ResumeEntryReferences(bed.resumes),
      resumes: bed.resumes,
      changes: bed.changes,
      measurer: bed.measurer,
    },
    clock: bed.clock,
    ids: bed.ids,
    model: bed.model,
    titleModel: null,
    activeRuns: new ActiveRunRegistry(),
    secrets: [],
    pdfExporter: new FixedBytesPdfExporter(),
    pdfSaver: new RecordingPdfFileSaver(),
  })
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  return {
    bed,
    services: {
      conversation,
      info: createInfoService({
        entries,
        customModules: new InMemoryCustomModuleRepository(entries, changes),
        references: new InMemoryEntryReferenceQuery(),
        clock: new FixedClock(),
        ids: new SequentialIdGenerator('list-info'),
      }),
      settings: createAppSettingsService({
        repository: new InMemoryAppSettingsRepository(DEFAULT_APP_SETTINGS),
      }),
      libraryChanges: {
        undo: async () => {
          throw new Error('not used in this test')
        },
        undoRevision: async () => {
          throw new Error('not used in this test')
        },
        readChange: async () => null,
      },
    },
  }
}

function conversationFixture(id: string, title: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: id as Conversation['id'],
    title,
    providerId: null,
    modelId: null,
    pinned: false,
    activeResumeId: null,
    summary: null,
    summaryThroughSeq: null,
    createdAt: '2026-01-01T00:00:00.000Z' as Conversation['createdAt'],
    updatedAt: '2026-01-01T00:00:00.000Z' as Conversation['updatedAt'],
    ...overrides,
  }
}

const GROUPS: ConversationGroups = {
  today: [conversationFixture('conversation-today', '今天的会话')],
  last7Days: [conversationFixture('conversation-week', '本周的会话')],
  earlier: [conversationFixture('conversation-old', '更早的会话')],
}

beforeEach(async () => {
  useConversationStore.getState().connect(null)
  await flush()
})

describe('groupSections', () => {
  it('puts pinned sessions first and keeps the date order afterwards', () => {
    const pinned = conversationFixture('conversation-pinned', '置顶会话', { pinned: true })
    const sections = groupSections(
      [pinned, ...GROUPS.today, ...GROUPS.last7Days, ...GROUPS.earlier],
      GROUPS,
    )

    expect(sections.map((section) => section.title)).toEqual([
      '置顶',
      '今天',
      '近 7 天',
      '更早',
    ])
    expect(sections[0]?.conversations.map((conversation) => conversation.id)).toEqual([
      'conversation-pinned',
    ])
  })

  it('omits a date heading that has no unpinned session left', () => {
    const today = conversationFixture('conversation-today', '今天的会话', { pinned: true })
    const sections = groupSections([today], { ...GROUPS, today: [today], last7Days: [], earlier: [] })

    expect(sections.map((section) => section.title)).toEqual(['置顶'])
  })
})

describe('ConversationList', () => {
  it('renders nothing in the icon-only sidebar', () => {
    const { container } = render(<ConversationList collapsed />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renames a session inline and pins it', async () => {
    const harness = createHarness()
    await harness.services.conversation.createConversation({ title: '原会话' })
    useConversationStore.getState().connect(harness.services)
    await flush()
    const user = userEvent.setup({ delay: null })
    render(<ConversationList collapsed={false} />)

    await screen.findByText('原会话')
    await user.click(screen.getByRole('button', { name: '重命名对话' }))
    const input = screen.getByRole('textbox', { name: '会话标题' })
    await user.clear(input)
    await user.type(input, '改名后的会话{Enter}')

    await waitFor(() => expect(useConversationStore.getState().conversations[0]?.title).toBe('改名后的会话'))

    await user.click(screen.getByRole('button', { name: '置顶对话' }))
    await waitFor(() => expect(useConversationStore.getState().conversations[0]?.pinned).toBe(true))
  })

  it('deletes a session after the confirmation', async () => {
    const harness = createHarness()
    await harness.services.conversation.createConversation({ title: '要删除的会话' })
    useConversationStore.getState().connect(harness.services)
    await flush()
    const user = userEvent.setup({ delay: null })
    render(<ConversationList collapsed={false} />)

    await screen.findByText('要删除的会话')
    await user.click(screen.getByRole('button', { name: '删除对话' }))
    await screen.findByRole('dialog', { name: '删除这段对话？' })
    await user.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(useConversationStore.getState().conversations).toEqual([]))
  })

  it('shows the empty state when no session is stored', async () => {
    const harness = createHarness()
    useConversationStore.getState().connect(harness.services)
    await flush()
    render(<ConversationList collapsed={false} />)

    expect(await screen.findByText('还没有对话')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始第一个对话' })).toBeInTheDocument()
  })
})
