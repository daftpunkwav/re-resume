/**
 * @file EmptyConversation.test
 * @description The welcome surface: the sample action appears while the window is
 * empty and disappears once the sample has been imported; clicking it calls the
 * seed capability.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationServicesProvider } from '../../../../src/presentation/app/ApplicationServicesProvider'
import { EmptyConversation } from '../../../../src/presentation/features/conversation/EmptyConversation'
import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import { useSettingsStore } from '../../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../../src/presentation/app/stores/shellStore'
import { useToastStore } from '../../../../src/presentation/app/stores/toastStore'
import { stubCompositionRoot } from '../../../../test/support/stubCompositionRoot'

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
