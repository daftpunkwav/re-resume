/**
 * @file topBar.test
 * @description The conversation header: the stored title with inline rename, the
 * model control, the panel switches and the delete confirmation.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../../../src/presentation/app/ApplicationServicesProvider'
import { TopBar } from '../../../../src/presentation/app/TopBar'
import { useConversationStore } from '../../../../src/presentation/features/conversation/stores/conversationStore'
import { useProviderStore } from '../../../../src/presentation/features/conversation/stores/providerStore'
import { useRunStore } from '../../../../src/presentation/features/conversation/stores/runStore'
import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import { useSettingsStore } from '../../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../../src/presentation/app/stores/shellStore'
import { stubCompositionRoot } from '../../../support/stubCompositionRoot'
import { storesForRoot } from '../../../../src/presentation/features/conversation/stores/connect'

function renderTopBar(root: ReturnType<typeof stubCompositionRoot>) {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => root}
      resolveSnapshotPath={async () => 'test.credentials.hold'}
    >
      <TopBar collapsed={false} />
    </ApplicationServicesProvider>,
  )
}

async function openTopBar() {
  const root = stubCompositionRoot()
  const stores = storesForRoot(root)
  useConversationStore.getState().connect(stores.conversation)
  useProviderStore.getState().connect(stores.providers)
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  const result = renderTopBar(root)
  await screen.findByRole('heading', { name: '梳理我的实习经历' })
  await waitFor(() => expect(useConversationStore.getState().listStatus).toBe('ready'))
  return result
}

beforeEach(() => {
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, status: 'ready', error: null })
  useShellStore.setState({ rightPanel: 'none', rightWidth: 400, sidebarCollapsed: false })
  useProviderStore.setState({ providers: [], activeProviderId: null, status: 'idle', error: null })
  useConversationStore.getState().connect(null)
  useRunStore.getState().reset()
})

describe('TopBar', () => {
  it('renames the open session inline', async () => {
    const user = userEvent.setup({ delay: null })
    await openTopBar()

    await user.click(screen.getByRole('button', { name: '梳理我的实习经历' }))
    const input = screen.getByRole('textbox', { name: '会话标题' })
    await user.clear(input)
    await user.type(input, '面试准备{Enter}')

    await waitFor(() =>
      expect(useConversationStore.getState().conversations.some((entry) => entry.title === '面试准备')).toBe(
        true,
      ),
    )
    expect(screen.getByRole('heading', { name: '面试准备' })).toBeInTheDocument()
  })

  it('restores the stored title when Escape cancels the rename', async () => {
    const user = userEvent.setup({ delay: null })
    await openTopBar()

    await user.click(screen.getByRole('button', { name: '梳理我的实习经历' }))
    const input = screen.getByRole('textbox', { name: '会话标题' })
    await user.clear(input)
    await user.type(input, '放弃修改')
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.getByRole('heading', { name: '梳理我的实习经历' })).toBeInTheDocument()
  })

  it('deletes the open session after the confirmation', async () => {
    const user = userEvent.setup({ delay: null })
    await openTopBar()

    await user.click(screen.getByRole('button', { name: '删除当前对话' }))
    await screen.findByRole('dialog', { name: '删除这段对话？' })
    await user.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() =>
      expect(
        useConversationStore
          .getState()
          .conversations.some((entry) => entry.title === '梳理我的实习经历'),
      ).toBe(false),
    )
  })
})
