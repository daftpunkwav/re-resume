/**
 * @file conversationStore.test
 * @description The stored side of the conversation against the real use cases:
 * list loading and restore, one send with its authoritative reload, cancel with
 * the partial answer kept, retry after a failure, the list operations, and the
 * per-write undo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChangeRecord } from '../../../../src/domain/changes/ChangeRecord'
import {
  asChangeRecordId,
  asMessageId,
  asResumeId,
  asRevisionId,
} from '../../../../src/domain/shared/branded-id'
import { ModelCallError } from '../../../../src/infrastructure/http/ProviderAdapters/errors'
import { createInfoService } from '../../../../src/bootstrap/wiring/info'
import { createConversationService } from '../../../../src/bootstrap/wiring/conversation'
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
import { useConversationStore } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import type { ConversationServices } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import { useRunStore } from '../../../../src/presentation/features/conversation/stores/runStore'
import { useSettingsStore } from '../../../../src/presentation/app/stores/settingsStore'
import { createConversationBed } from '../../../support/conversationBed'
import type { ConversationBed } from '../../../support/conversationBed'
import { FixedClock, SequentialIdGenerator } from '../../../support/fakeEnvironment'

interface Harness {
  readonly bed: ConversationBed
  readonly services: ConversationServices
  readonly undo: ReturnType<typeof vi.fn>
  readonly undoRevision: ReturnType<typeof vi.fn>
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
  })
  const infoClock = new FixedClock()
  const infoIds = new SequentialIdGenerator('info')
  const changes = new InMemoryChangeLogRepository()
  const entries = new InMemoryInfoEntryRepository(changes)
  const customModules = new InMemoryCustomModuleRepository(entries, changes)
  const info = createInfoService({
    entries,
    customModules,
    references: new InMemoryEntryReferenceQuery(),
    clock: infoClock,
    ids: infoIds,
  })
  const settingsRepository = new InMemoryAppSettingsRepository(DEFAULT_APP_SETTINGS)
  const undo = vi.fn(async (input: { changeId: string }) => ({ id: input.changeId }) as unknown as ChangeRecord)
  const undoRevision = vi.fn(async () => ({ label: '修改' }))
  return {
    bed,
    undo,
    undoRevision,
    services: {
      conversation,
      info,
      settings: createAppSettingsService({ repository: settingsRepository }),
      libraryChanges: { undo, undoRevision },
    },
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function connect(harness: Harness): Promise<void> {
  useConversationStore.getState().connect(harness.services)
  await flush()
}



beforeEach(() => {
  useRunStore.getState().reset()
  useConversationStore.getState().connect(null)
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, status: 'ready', error: null })
})

afterEach(() => {
  useConversationStore.getState().connect(null)
})

describe('conversationStore loading', () => {
  it('restores the most recent stored session on connect', async () => {
    const harness = createHarness()
    const first = await harness.services.conversation.createConversation({ title: '更早的会话' })
    await new Promise((resolve) => {
      setTimeout(resolve, 5)
    })
    const second = await harness.services.conversation.createConversation({ title: '最新的会话' })
    await harness.services.conversation.appendMessage({
      conversationId: second.id,
      kind: 'user',
      markdown: '你好',
    })
    await connect(harness)
    await flush()

    const state = useConversationStore.getState()
    expect(state.listStatus).toBe('ready')
    expect(state.conversations.map((entry) => entry.title)).toEqual(['最新的会话', '更早的会话'])
    expect(state.activeId).toBe(second.id)
    expect(state.messages.map((message) => message.markdown)).toEqual(['你好'])
    expect(first.id).not.toBe(second.id)
  })

  it('keeps the draft when nothing is stored', async () => {
    const harness = createHarness()
    await connect(harness)
    await flush()

    expect(useConversationStore.getState().activeId).toBeNull()
    expect(useConversationStore.getState().draft).toBe(true)
  })
})

describe('conversationStore send flow', () => {
  it('creates the session, sends the turn and shows the stored answer', async () => {
    const harness = createHarness()
    harness.bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '我先看一下岗位。' }] })
    await connect(harness)
    await flush()

    useConversationStore.getState().setComposerText('帮我准备简历')
    await useConversationStore.getState().send()
    await flush()

    const state = useConversationStore.getState()
    expect(state.activeId).not.toBeNull()
    expect(state.draft).toBe(false)
    expect(state.messages.map((message) => message.kind)).toEqual(['user', 'assistant'])
    expect(state.messages[0]?.markdown).toBe('帮我准备简历')
    expect(state.messages[1]?.markdown).toBe('我先看一下岗位。')
    expect(state.messages[1]?.status).toBe('complete')
    expect(state.composer.text).toBe('')
    // The first turn renamed the default session from its text.
    expect(state.conversations[0]?.title).toBe('帮我准备简历')
  })

  it('sends the context chips with the user turn', async () => {
    const harness = createHarness()
    harness.bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '收到。' }] })
    await connect(harness)
    await flush()

    useConversationStore
      .getState()
      .addContext({ kind: 'entry', refId: 'entry-1' as never }, '项目经历：订单中台')
    useConversationStore.getState().setComposerText('看看这条')
    await useConversationStore.getState().send()
    await flush()

    const user = useConversationStore.getState().messages[0]
    expect(user?.kind).toBe('user')
    const contexts = useConversationStore.getState().contextsByMessage[user?.id ?? '']
    expect(contexts).toEqual([{ kind: 'entry', refId: 'entry-1' }])
    expect(useConversationStore.getState().composer.contexts).toEqual([])
  })

  it('keeps the partial answer and records the cancellation', async () => {
    const harness = createHarness()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    harness.bed.model.enqueue({
      chunks: [
        { type: 'text', textDelta: '第一段' },
        { type: 'text', textDelta: '第二段' },
      ],
      beforeEachChunk: () => gate,
    })
    await connect(harness)
    await flush()

    useConversationStore.getState().setComposerText('写一段')
    const sending = useConversationStore.getState().send()
    for (let index = 0; index < 50 && !useRunStore.getState().started; index += 1) {
      await flush()
    }
    expect(useRunStore.getState().started).toBe(true)

    await useConversationStore.getState().cancel()
    release()
    await sending
    await flush()

    const assistant = useConversationStore.getState().messages.at(-1)
    expect(assistant?.status).toBe('cancelled')
    expect(assistant?.markdown).toBe('第一段')
    expect(assistant?.errorText).toBe('已取消')
  })

  it('retries a failed answer and replaces it with the new one', async () => {
    const harness = createHarness()
    harness.bed.model.enqueue({
      error: new ModelCallError('服务拒绝', { retryable: false, status: 400 }),
    })
    harness.bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '这次成功' }] })
    await connect(harness)
    await flush()

    useConversationStore.getState().setComposerText('再试一次')
    await useConversationStore.getState().send()
    await flush()
    const failed = useConversationStore.getState().messages.at(-1)
    expect(failed?.status).toBe('failed')
    expect(useConversationStore.getState().error?.message).toContain('服务拒绝')

    await useConversationStore.getState().retry(asMessageId(failed?.id ?? ''))
    await flush()

    const messages = useConversationStore.getState().messages
    expect(messages.map((message) => message.kind)).toEqual(['user', 'assistant'])
    expect(messages.at(-1)?.status).toBe('complete')
    expect(messages.at(-1)?.markdown).toBe('这次成功')
  })
})

describe('conversationStore list operations', () => {
  it('renames, pins and deletes a stored session', async () => {
    const harness = createHarness()
    const created = await harness.services.conversation.createConversation({ title: '原会话' })
    await connect(harness)
    await flush()

    const renamed = await useConversationStore.getState().renameConversation(created.id, '新标题')
    expect(renamed).toBe(true)
    expect(useConversationStore.getState().conversations[0]?.title).toBe('新标题')

    const pinned = await useConversationStore.getState().togglePinned(created.id, true)
    expect(pinned).toBe(true)
    expect(useConversationStore.getState().conversations[0]?.pinned).toBe(true)

    const removed = await useConversationStore.getState().removeConversation(created.id)
    expect(removed).toBe(true)
    expect(useConversationStore.getState().conversations).toEqual([])
    expect(useConversationStore.getState().activeId).toBeNull()
  })

  it('reports a refused rename without dropping the row', async () => {
    const harness = createHarness()
    const created = await harness.services.conversation.createConversation({ title: '原会话' })
    await connect(harness)
    await flush()

    const renamed = await useConversationStore
      .getState()
      .renameConversation(created.id, ' '.repeat(3))

    expect(renamed).toBe(false)
    expect(useConversationStore.getState().conversations[0]?.title).toBe('原会话')
    expect(useConversationStore.getState().error?.message).toBe('必填项不能为空。')
  })
})

describe('conversationStore undo', () => {
  it('calls the library undo once and marks the change undone', async () => {
    const harness = createHarness()
    await connect(harness)
    await flush()

    const done = await useConversationStore
      .getState()
      .undoChange(asChangeRecordId('change-1'))

    expect(done).toBe(true)
    expect(harness.undo).toHaveBeenCalledWith({ changeId: 'change-1' })
    expect(useConversationStore.getState().undone.has('change-1')).toBe(true)
    await expect(
      useConversationStore.getState().undoChange(asChangeRecordId('change-1')),
    ).resolves.toBe(false)
  })

  it('reports the reason the undo was refused', async () => {
    const harness = createHarness()
    harness.undo.mockRejectedValueOnce(new Error('这条变更已经撤销过了。'))
    await connect(harness)
    await flush()

    const done = await useConversationStore
      .getState()
      .undoChange(asChangeRecordId('change-1'))

    expect(done).toBe(false)
    expect(useConversationStore.getState().error?.message).toContain('已经撤销')
    expect(useConversationStore.getState().undone.has('change-1')).toBe(false)
  })

  it('reverses a resume revision through the revision capability', async () => {
    const harness = createHarness()
    await connect(harness)
    await flush()

    const done = await useConversationStore
      .getState()
      .undoRevision(asResumeId('resume-1'), asRevisionId('revision-1'))

    expect(done).toBe(true)
    expect(harness.undoRevision).toHaveBeenCalledWith({
      resumeId: 'resume-1',
      revisionId: 'revision-1',
    })
    expect(useConversationStore.getState().undone.has('revision-1')).toBe(true)
    await expect(
      useConversationStore
        .getState()
        .undoRevision(asResumeId('resume-1'), asRevisionId('revision-1')),
    ).resolves.toBe(false)
  })

  it('reports a refused revision undo and keeps the button available', async () => {
    const harness = createHarness()
    harness.undoRevision.mockRejectedValueOnce(new Error('已不是当前版本。'))
    await connect(harness)
    await flush()

    const done = await useConversationStore
      .getState()
      .undoRevision(asResumeId('resume-1'), asRevisionId('revision-1'))

    expect(done).toBe(false)
    expect(useConversationStore.getState().error?.message).toContain('当前版本')
    expect(useConversationStore.getState().undone.has('revision-1')).toBe(false)
    expect(useConversationStore.getState().undoBusy.has('revision-1')).toBe(false)
  })
})
