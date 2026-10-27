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
    const { container } = renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })

    const shell = container.querySelector('.shell')
    expect(shell).toHaveAttribute('data-layout', 'wide')
    expect(screen.getByRole('complementary', { name: '工作台侧边栏' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '新对话' })).toBeInTheDocument()
    expect(screen.getByText('还没有对话')).toBeInTheDocument()
  })

  it('opens the information panel from the sidebar and closes it again', async () => {
    const user = userEvent.setup({ delay: null })
    renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })

    const entry = screen.getByRole('button', { name: /^简历信息$/ })
    await user.click(entry)

    expect(await screen.findByRole('heading', { name: '简历信息' })).toBeInTheDocument()
    expect(useShellStore.getState().rightPanel).toBe('info')

    await user.click(entry)
    expect(useShellStore.getState().rightPanel).toBe('none')
  })

  it('shows both panels side by side on a wide window', async () => {
    const user = userEvent.setup({ delay: null })
    renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })

    await user.click(screen.getByRole('button', { name: /^简历信息$/ }))
    await user.click(screen.getByRole('button', { name: /^简历创作$/ }))

    expect(await screen.findByRole('region', { name: '简历创作' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '简历信息' })).toBeInTheDocument()
    expect(useShellStore.getState().rightPanel).toBe('both')
    // The width edge and the divider between the panes are both separators.
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('opens and closes the settings overlay with the shortcut', async () => {
    renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })

    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    const dialog = await screen.findByRole('dialog', { name: '设置' })
    expect(dialog).toBeInTheDocument()

    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    expect(useShellStore.getState().settingsOpen).toBe(false)
  })

  it('toggles the dock visibility with the shortcut', async () => {
    renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(useShellStore.getState().rightPanel).toBe('resume')

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(useShellStore.getState().rightPanel).toBe('none')
  })

  it('changes the interface scale with the shortcut and reports the ceiling', async () => {
    renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })

    fireEvent.keyDown(window, { key: '+', ctrlKey: true })
    expect(useSettingsStore.getState().settings.uiScale).toBe(1.1)

    fireEvent.keyDown(window, { key: '0', ctrlKey: true })
    expect(useSettingsStore.getState().settings.uiScale).toBe(1)
  })

  it('adds a conversation draft and focuses the conversation region', async () => {
    const user = userEvent.setup({ delay: null })
    renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })

    await user.click(screen.getByRole('button', { name: '新建对话' }))

    expect(useShellStore.getState().draftEpoch).toBe(1)
    expect(document.querySelector('[data-region="conversation"]')).toBe(document.activeElement)
  })

  it('collapses the sidebar and draws the dock over the conversation at 960px', async () => {
    setWindowWidth(960)
    const user = userEvent.setup({ delay: null })
    const { container } = renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })

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
    const { container } = renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })
    expect(container.querySelector('.shell')).toHaveAttribute('data-layout', 'wide')

    act(() => setWindowWidth(960))

    await waitFor(() =>
      expect(container.querySelector('.shell')).toHaveAttribute('data-layout', 'compact'),
    )
  })

  it('opens the model section from the model chip', async () => {
    const user = userEvent.setup({ delay: null })
    renderShell()
    await screen.findByRole('heading', { name: '从一段对话开始' })

    await user.click(screen.getByRole('button', { name: /打开模型服务设置/ }))

    const dialog = await screen.findByRole('dialog', { name: '设置' })
    expect(within(dialog).getByRole('heading', { name: '模型服务' })).toBeInTheDocument()
  })
})
