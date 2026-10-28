/**
 * @file AppShell.test
 * @description The three-column frame at both window widths: which regions are
 * visible, how the panel entries toggle the dock, and the global shortcuts that
 * move between them.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../../src/presentation/app/ApplicationServicesProvider'
import { AppShell } from '../../../src/presentation/app/AppShell'
import { DEFAULT_APP_SETTINGS } from '../../../src/domain/settings/AppSettings'
import { useSettingsStore } from '../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../src/presentation/app/stores/shellStore'
import { useConversationStore } from '../../../src/presentation/features/conversation/stores/conversationStore'
import { useProviderStore } from '../../../src/presentation/features/conversation/stores/providerStore'
import { useRunStore } from '../../../src/presentation/features/conversation/stores/runStore'
import { stubCompositionRoot } from '../../support/stubCompositionRoot'

function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
  window.dispatchEvent(new Event('resize'))
}

function renderShell() {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => stubCompositionRoot()}
      resolveSnapshotPath={async () => 'test.credentials.hold'}
    >
      <AppShell />
    </ApplicationServicesProvider>,
  )
}

/**
 * Render the shell and wait until the boot promise has settled, the session list
 * has been read and the most recent session is open. `findByRole` can observe the
 * committed DOM before those passive effects run, so a resize or shortcut
 * dispatched right after render would otherwise race the listener installation.
 */
async function renderShellReady(): Promise<ReturnType<typeof render>> {
  const result = renderShell()
  await screen.findByRole('heading', { name: '梳理我的实习经历' })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  return result
}

function resetStores(): void {
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, status: 'ready', error: null })
  useShellStore.setState({
    rightPanel: 'none',
    rightWidth: 400,
    sidebarCollapsed: false,
    settingsOpen: false,
    settingsSection: 'appearance',
    focusDomain: 'conversation',
    draftEpoch: 0,
    lastOpenPanel: 'resume',
  })
  useConversationStore.setState({
    conversations: [],
    groups: null,
    activeId: null,
    draft: false,
    messages: [],
    messagesStatus: 'idle',
    listStatus: 'idle',
    error: null,
    pendingUser: null,
    composer: { text: '', contexts: [], attachments: [] },
    contextsByMessage: {},
    contextEntries: {},
    enterIds: new Set<string>(),
    undoBusy: new Set<string>(),
    undone: new Set<string>(),
  })
  useProviderStore.setState({ providers: [], activeProviderId: null, status: 'idle', error: null })
  useRunStore.getState().reset()
}

beforeEach(() => {
  resetStores()
  setWindowWidth(1280)
})

afterEach(() => {
  setWindowWidth(1024)
})

describe('AppShell', () => {
  it('lays out the sidebar, conversation and header on a wide window', async () => {
    const { container } = await renderShellReady()

    const shell = container.querySelector('.shell')
    expect(shell).toHaveAttribute('data-layout', 'wide')
    expect(screen.getByRole('complementary', { name: '工作台侧边栏' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '梳理我的实习经历' })).toBeInTheDocument()
    // The stored sessions are grouped in the sidebar instead of the old empty slot.
    expect(screen.getByRole('region', { name: '置顶' })).toBeInTheDocument()
    expect(screen.getByText('为字节跳动前端岗位准备简历')).toBeInTheDocument()
  })

  it('opens the information panel from the sidebar and closes it again', async () => {
    const user = userEvent.setup({ delay: null })
    await renderShellReady()

    const entry = screen.getByRole('button', { name: /^简历信息$/ })
    await user.click(entry)

    expect(await screen.findByRole('heading', { name: '简历信息' })).toBeInTheDocument()
    expect(useShellStore.getState().rightPanel).toBe('info')

    await user.click(entry)
    expect(useShellStore.getState().rightPanel).toBe('none')
  })

  it('shows both panels side by side on a window wide enough to split', async () => {
    setWindowWidth(1600)
    const user = userEvent.setup({ delay: null })
    await renderShellReady()

    await user.click(screen.getByRole('button', { name: /^简历信息$/ }))
    await user.click(screen.getByRole('button', { name: /^简历创作$/ }))

    expect(await screen.findByRole('region', { name: '简历创作' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '简历信息' })).toBeInTheDocument()
    expect(useShellStore.getState().rightPanel).toBe('both')
    // The width edge and the divider between the panes are both separators.
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('keeps one pane behind the tabs when both are requested below the split floor', async () => {
    const user = userEvent.setup({ delay: null })
    await renderShellReady()

    await user.click(screen.getByRole('button', { name: /^简历创作$/ }))
    await user.click(screen.getByRole('button', { name: /^简历信息$/ }))

    expect(useShellStore.getState().rightPanel).toBe('both')
    // 1280 leaves too little conversation beside two panes, so the dock keeps
    // one visible pane and switches between them with the tabs. The panel that
    // was just requested is the one in front.
    expect(screen.getByRole('tablist', { name: '面板切换' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '简历信息' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByRole('region', { name: '简历创作' })).toBeNull()
    expect(screen.queryByRole('region', { name: '简历信息' })).toBeNull()
  })

  it('opens and closes the settings overlay with the shortcut', async () => {
    await renderShellReady()

    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    const dialog = await screen.findByRole('dialog', { name: '设置' })
    expect(dialog).toBeInTheDocument()

    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    expect(useShellStore.getState().settingsOpen).toBe(false)
  })

  it('toggles the dock visibility with the shortcut', async () => {
    await renderShellReady()

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(useShellStore.getState().rightPanel).toBe('resume')

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(useShellStore.getState().rightPanel).toBe('none')
  })

  it('changes the interface scale with the shortcut and reports the ceiling', async () => {
    await renderShellReady()

    fireEvent.keyDown(window, { key: '+', ctrlKey: true })
    expect(useSettingsStore.getState().settings.uiScale).toBe(1.1)

    fireEvent.keyDown(window, { key: '0', ctrlKey: true })
    expect(useSettingsStore.getState().settings.uiScale).toBe(1)
  })

  it('starts a new draft and focuses the conversation region', async () => {
    const user = userEvent.setup({ delay: null })
    await renderShellReady()

    await user.click(screen.getByRole('button', { name: '新建对话' }))

    expect(useShellStore.getState().draftEpoch).toBe(1)
    // The draft replaces the stored transcript with the welcome region and puts
    // the caret where the first message will be typed.
    expect(await screen.findByRole('heading', { name: '从一段对话开始' })).toBeInTheDocument()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '输入消息' })),
    )
  })

  it('collapses the sidebar and draws the dock over the conversation at 960px', async () => {
    setWindowWidth(960)
    const user = userEvent.setup({ delay: null })
    const { container } = await renderShellReady()

    expect(container.querySelector('.shell')).toHaveAttribute('data-layout', 'compact')
    // The labels are gone; the accessible names remain.
    expect(container.querySelector('.sidebar')).toHaveClass('sidebar-collapsed')
    expect(screen.getByRole('button', { name: /^简历信息$/ })).toBeInTheDocument()
    expect(screen.queryByText('简历创作')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^简历创作$/ }))

    expect(container.querySelector('.drawer-scrim')).not.toBeNull()
    expect(await screen.findByRole('heading', { name: '简历创作' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useShellStore.getState().rightPanel).toBe('none')
    expect(container.querySelector('.drawer-scrim')).toBeNull()
  })

  it('changes the layout tier when the window is resized', async () => {
    const { container } = await renderShellReady()
    expect(container.querySelector('.shell')).toHaveAttribute('data-layout', 'wide')

    act(() => setWindowWidth(960))

    await waitFor(
      () => expect(container.querySelector('.shell')).toHaveAttribute('data-layout', 'compact'),
      { timeout: 3000 },
    )
  })

  it('opens the model section from the set-up entry when no service is configured', async () => {
    const user = userEvent.setup({ delay: null })
    await renderShellReady()

    // The model control, the composer hint and the welcome action all lead to the
    // same section; any of them is the setup path.
    await user.click((await screen.findAllByRole('button', { name: /配置模型服务/ }))[0] as HTMLElement)

    const dialog = await screen.findByRole('dialog', { name: '设置' })
    expect(within(dialog).getByRole('heading', { name: '模型服务' })).toBeInTheDocument()
  })
})
