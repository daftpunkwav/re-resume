/**
 * @file EmptyConversation.test
 * @description The welcome surface: the sample action appears while the window is
 * empty and disappears once the sample has been imported; clicking it calls the
 * seed capability.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationServicesProvider } from '../../../../src/presentation/app/ApplicationServicesProvider'
import { EmptyConversation } from '../../../../src/presentation/features/conversation/EmptyConversation'
import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import { useSettingsStore } from '../../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../../src/presentation/app/stores/shellStore'
import { useToastStore } from '../../../../src/presentation/app/stores/toastStore'
import { stubCompositionRoot } from '../../../../test/support/stubCompositionRoot'
import { useConversationStore } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import { useProviderStore } from '../../../../src/presentation/features/conversation/stores/providerStore'
import { MESSAGE_WINDOW } from '../../../../src/presentation/features/conversation/stores/conversationStore'

function renderWelcome(seedSampleData = vi.fn(async () => ({
  alreadySeeded: false,
  infoEntries: 23,
  resumes: 2,
  messages: 3,
  conversationId: null,
}))) {
  const root = stubCompositionRoot({ seed: { seedSampleData } })
  render(
    <ApplicationServicesProvider
      createRoot={async () => root}
      resolveSnapshotPath={async () => '/tmp/credentials.hold'}
    >
      <EmptyConversation />
    </ApplicationServicesProvider>,
  )
  return seedSampleData
}

beforeEach(() => {
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, status: 'ready', error: null })
  useShellStore.setState({ settingsOpen: false, rightPanel: 'none' })
  useToastStore.setState({ toasts: [] })
})

describe('EmptyConversation', () => {
  it('offers the sample library while nothing has been seeded', async () => {
    const seed = renderWelcome()

    await userEvent.setup({ delay: null }).click(
      await screen.findByRole('button', { name: /导入示例数据/ }),
    )

    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1))
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('示例数据已导入')
  })

  it('does not offer it again after the sample was imported', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_APP_SETTINGS, sampleDataSeeded: true },
      status: 'ready',
      error: null,
    })
    const root = stubCompositionRoot({
      seed: { seedSampleData: vi.fn() },
      settings: {
        read: async () => ({ ...DEFAULT_APP_SETTINGS, sampleDataSeeded: true }),
        save: async (patch) => ({ ...DEFAULT_APP_SETTINGS, sampleDataSeeded: true, ...patch }),
      },
    })
    render(
      <ApplicationServicesProvider
        createRoot={async () => root}
        resolveSnapshotPath={async () => '/tmp/credentials.hold'}
      >
        <EmptyConversation />
      </ApplicationServicesProvider>,
    )

    await screen.findByText('从一段对话开始')
    expect(screen.queryByRole('button', { name: /导入示例数据/ })).toBeNull()
  })
})

describe('EmptyConversation job screenshots', () => {
  function pngFile(name: string, marker: number): File {
    const bytes = new Uint8Array(64)
    bytes[0] = marker
    return new File([bytes], name, { type: 'image/png' })
  }

  async function renderDialog(root: ReturnType<typeof stubCompositionRoot>) {
    useConversationStore.getState().connect({
      conversation: root.conversation,
      info: root.info,
      settings: root.settings,
      libraryChanges: root.libraryChanges,
    })
    await waitFor(() => {
      expect(useConversationStore.getState().listStatus).toBe('ready')
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    // The welcome surface belongs to a fresh draft; the preview fixtures open a
    // stored session when the store connects, so reset to the state under test.
    useConversationStore.getState().startDraft()
    render(
      <ApplicationServicesProvider
        createRoot={async () => root}
        resolveSnapshotPath={async () => '/tmp/credentials.hold'}
      >
        <EmptyConversation />
      </ApplicationServicesProvider>,
    )
    await screen.findByText('从一段对话开始')
    await userEvent.setup({ delay: null }).click(
      screen.getByRole('button', { name: /粘贴岗位描述/ }),
    )
    return screen.findByRole('dialog', { name: '粘贴岗位描述' })
  }

  it('sends an uploaded screenshot as the first user turn with its attachment', async () => {
    const root = stubCompositionRoot()
    const dialog = await renderDialog(root)
    const fileInput = dialog.querySelector('input[type="file"]')
    expect(fileInput).not.toBeNull()

    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [pngFile('岗位截图.png', 1)] },
    })
    await screen.findByText('岗位截图.png')

    await userEvent.setup({ delay: null }).click(
      within(dialog).getByRole('button', { name: '发送给助手' }),
    )

    await waitFor(() => {
      expect(useConversationStore.getState().activeId).not.toBeNull()
    })
    const conversationId = useConversationStore.getState().activeId
    await waitFor(() => {
      expect(useConversationStore.getState().messages.some((message) => message.kind === 'user')).toBe(
        true,
      )
    })
    const stored = await root.conversation.listMessages(conversationId as never, MESSAGE_WINDOW)
    const user = stored.find((message) => message.kind === 'user')
    expect(user?.markdown).toBe('帮我针对这个岗位做简历')
    expect(user?.attachmentIds).toHaveLength(1)
    expect(screen.queryByRole('dialog', { name: '粘贴岗位描述' })).toBeNull()
  })

  it('refuses to send a screenshot to a model that cannot read images', async () => {
    useProviderStore.setState({
      status: 'ready',
      activeProviderId: 'provider-text',
      providers: [
        {
          config: {
            id: 'provider-text',
            name: '纯文本模型',
            kind: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: 'gpt-3.5-turbo',
            secretRef: 'provider:provider-text',
            supportsImages: false,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z' as never,
            updatedAt: '2026-01-01T00:00:00.000Z' as never,
          },
          hasCredential: true,
          supportsImages: false,
        },
      ],
    })
    const root = stubCompositionRoot()
    const dialog = await renderDialog(root)
    const fileInput = dialog.querySelector('input[type="file"]')
    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [pngFile('岗位截图.png', 2)] },
    })

    expect(await within(dialog).findByText(/当前模型不支持图片输入/)).toBeInTheDocument()
    await userEvent.setup({ delay: null }).click(
      within(dialog).getByRole('button', { name: '发送给助手' }),
    )
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(useConversationStore.getState().activeId).toBeNull()
  })
})
