/**
 * @file conversationView.test
 * @description The conversation surface end to end against a real conversation
 * service: restored transcript, tool cards with undo, streaming, stopping,
 * IME-safe Enter, the empty-state quick action and the failure notice with its
 * retry entry.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../../../src/presentation/app/ApplicationServicesProvider'
import { ConversationView } from '../../../../src/presentation/features/conversation/ConversationView'
import { useConversationStore } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import { useRunStore } from '../../../../src/presentation/features/conversation/stores/runStore'
import { useProviderStore } from '../../../../src/presentation/features/conversation/stores/providerStore'
import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import { useSettingsStore } from '../../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../../src/presentation/app/stores/shellStore'
import { createPreviewRoot } from '../../../../src/bootstrap/previewRoot'
import { createConversationService } from '../../../../src/bootstrap/wiring/conversation'
import { ActiveRunRegistry } from '../../../../src/application/generation/activeRunRegistry'
import { ResumeEntryReferences } from '../../../../src/infrastructure/persistence/resume/ResumeEntryReferences'
import { ModelCallError } from '../../../../src/infrastructure/http/ProviderAdapters/errors'
import type { CompositionRoot } from '../../../../src/bootstrap/capabilities'
import { stubCompositionRoot } from '../../../support/stubCompositionRoot'
import { createConversationBed } from '../../../support/conversationBed'
import type { ConversationBed } from '../../../support/conversationBed'
import { FixedBytesPdfExporter, RecordingPdfFileSaver } from '../../../support/pdfDoubles'

function renderView(root: CompositionRoot) {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => root}
      resolveSnapshotPath={async () => 'test.credentials.hold'}
    >
      <ConversationView />
    </ApplicationServicesProvider>,
  )
}

function conversationServiceFor(bed: ConversationBed) {
  return createConversationService({
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
}

async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

beforeEach(() => {
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, status: 'ready', error: null })
  useShellStore.setState({ draftEpoch: 0, settingsOpen: false, rightPanel: 'none' })
  useProviderStore.setState({ providers: [], activeProviderId: null, status: 'idle', error: null })
  useConversationStore.getState().connect(null)
  useRunStore.getState().reset()
})

afterEach(() => {
  useConversationStore.getState().connect(null)
})

describe('the restored transcript', () => {
  it('shows the stored turns, the context chips and the tool cards', async () => {
    renderView(createPreviewRoot())

    expect(await screen.findByRole('log', { name: '对话消息' })).toBeInTheDocument()
    // The streamed text is not a live region; the run status node is what a
    // screen reader hears.
    const status = document.querySelector('.visually-hidden[role="status"]')
    expect(status).not.toBeNull()
    expect(
      await screen.findByText(/帮我针对字节跳动的前端岗位整理一份简历/),
    ).toBeInTheDocument()
    // The user turn carries the stored context chip, resolved through the
    // information library.
    expect(screen.getByTitle('项目经历：订单中台重构')).toBeInTheDocument()
    // The assistant answer is Markdown.
    expect(screen.getByText('订单中台重构')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /检索信息条目/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /更新项目经历/ })).toBeInTheDocument()
  })

  it('expands a write card and undoes the recorded change', async () => {
    const user = userEvent.setup({ delay: null })
    renderView(createPreviewRoot())
    await screen.findByRole('log', { name: '对话消息' })

    const card = await screen.findByRole('button', { name: /更新项目经历/ })
    expect(card).toHaveAttribute('aria-expanded', 'false')
    await user.click(card)

    expect(await screen.findByText(/原始内容仍可撤销/)).toBeInTheDocument()
    const undo = screen.getByRole('button', { name: /撤销此项/ })
    await user.click(undo)

    expect(await screen.findByText('已撤销')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /撤销此项/ })).toBeNull()
    // The button is gone once the change is undone.
  })

  it('lists the configured model service and probes it', async () => {
    const user = userEvent.setup({ delay: null })
    renderView(createPreviewRoot())
    await screen.findByRole('log', { name: '对话消息' })

    const chip = await screen.findByRole('button', { name: /当前模型服务：示例模型服务/ })
    await user.click(chip)
    const dialog = await screen.findByRole('dialog', { name: '模型服务' })
    expect(within(dialog).getByRole('option', { name: /示例模型服务/ })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '测试连接' }))
    expect(await within(dialog).findByText(/连接正常/)).toBeInTheDocument()
  })
})

describe('the composer', () => {
  it('sends on Enter but not while an IME composition is active', async () => {
    const bed = createConversationBed()
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '收到。' }] })
    renderView(stubCompositionRoot({ conversation: conversationServiceFor(bed) }))

    expect(await screen.findByRole('heading', { name: '从一段对话开始' })).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: '输入消息' })

    fireEvent.change(input, { target: { value: '帮我改简历' } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    await settle()
    expect(useRunStore.getState().status).toBe('idle')
    expect(useRunStore.getState().started).toBe(false)

    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(useRunStore.getState().started).toBe(true))
    expect((await screen.findAllByText('帮我改简历')).length).toBeGreaterThan(0)
    expect(await screen.findByText('收到。')).toBeInTheDocument()
  })

  it('swaps send for stop and records the cancellation', async () => {
    const bed = createConversationBed()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    bed.model.enqueue({
      chunks: [{ type: 'text', textDelta: '第一段' }],
      beforeEachChunk: () => gate,
    })
    renderView(stubCompositionRoot({ conversation: conversationServiceFor(bed) }))
    await screen.findByRole('heading', { name: '从一段对话开始' })
    await waitFor(() => expect(useConversationStore.getState().listStatus).toBe('ready'))

    const input = screen.getByRole('textbox', { name: '输入消息' })
    fireEvent.change(input, { target: { value: '写一段经历' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(useRunStore.getState().started).toBe(true))

    const stop = await screen.findByRole('button', { name: /停止/ })
    fireEvent.click(stop)
    release()

    expect((await screen.findAllByText('已取消')).length).toBeGreaterThan(0)
    await waitFor(() => expect(useRunStore.getState().status).toBe('idle'))
  })

  it('opens the paste dialog from the empty state and sends the posting', async () => {
    const bed = createConversationBed()
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '我来按岗位整理。' }] })
    const user = userEvent.setup({ delay: null })
    renderView(stubCompositionRoot({ conversation: conversationServiceFor(bed) }))
    await screen.findByRole('heading', { name: '从一段对话开始' })
    await waitFor(() => expect(useConversationStore.getState().listStatus).toBe('ready'))

    await user.click(screen.getByRole('button', { name: /粘贴岗位描述/ }))
    const dialog = await screen.findByRole('dialog', { name: '粘贴岗位描述' })
    await user.type(
      within(dialog).getByRole('textbox', { name: '岗位描述' }),
      '负责前端页面开发，熟悉 React。',
    )
    await user.click(within(dialog).getByRole('button', { name: '发送给助手' }))

    expect(await screen.findByText(/负责前端页面开发/)).toBeInTheDocument()
    expect(await screen.findByText('我来按岗位整理。')).toBeInTheDocument()
  })

  it('reports a failed turn and retries it from the notice', async () => {
    const bed = createConversationBed()
    bed.model.enqueue({
      error: new ModelCallError('模型服务不可用', { retryable: false, status: 503 }),
    })
    bed.model.enqueue({ chunks: [{ type: 'text', textDelta: '重试成功' }] })
    renderView(stubCompositionRoot({ conversation: conversationServiceFor(bed) }))
    await screen.findByRole('heading', { name: '从一段对话开始' })
    await waitFor(() => expect(useConversationStore.getState().listStatus).toBe('ready'))

    const input = screen.getByRole('textbox', { name: '输入消息' })
    fireEvent.change(input, { target: { value: '试试看' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByText('这次操作没有完成')).toBeInTheDocument()
    expect((await screen.findAllByText(/模型服务不可用/)).length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[0] as HTMLElement)
    expect(await screen.findByText('重试成功')).toBeInTheDocument()
  })

  it('keeps the draft in the composer when the send fails before starting', async () => {
    const bed = createConversationBed()
    const failing = { ...conversationServiceFor(bed) }
    renderView(
      stubCompositionRoot({
        conversation: {
          ...failing,
          createConversation: async () => {
            throw new Error('数据库不可用')
          },
        },
      }),
    )
    await screen.findByRole('heading', { name: '从一段对话开始' })
    await waitFor(() => expect(useConversationStore.getState().listStatus).toBe('ready'))

    const input = screen.getByRole('textbox', { name: '输入消息' })
    fireEvent.change(input, { target: { value: '不要丢掉我' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByText('这次操作没有完成')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: '输入消息' })).toHaveValue('不要丢掉我'))
  })
})
