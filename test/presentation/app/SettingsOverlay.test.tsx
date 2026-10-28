/**
 * @file SettingsOverlay.test
 * @description The settings surface as the window uses it: sections, live
 * appearance changes, the keyboard contract, and the honest empty states of the
 * sections whose forms belong to a later change.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../../src/presentation/app/ApplicationServicesProvider'
import { SettingsOverlay } from '../../../src/presentation/app/settings/SettingsOverlay'
import { Button } from '../../../src/presentation/app/components/Button'
import { DEFAULT_APP_SETTINGS } from '../../../src/domain/settings/AppSettings'
import { useSettingsStore } from '../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../src/presentation/app/stores/shellStore'
import { stubCompositionRoot } from '../../support/stubCompositionRoot'

function renderOverlay() {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => stubCompositionRoot()}
      resolveSnapshotPath={async () => 'test.credentials.hold'}
    >
      <Button
        onClick={() => {
          useShellStore.getState().openSettings()
          useShellStore.getState().setFocusDomain('conversation')
        }}
      >
        打开设置
      </Button>
      <SettingsOverlay />
    </ApplicationServicesProvider>,
  )
}

/**
 * The dialog appears when the presence state flips to open; the passive effects
 * that install its focus trap and keyboard handling run after that commit. A key
 * press dispatched straight after `findByRole` can therefore arrive before the
 * listener exists, so wait one settled task before sending keys.
 */
async function settleOverlay(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}


beforeEach(() => {
  useSettingsStore.setState({
    settings: DEFAULT_APP_SETTINGS,
    status: 'ready',
    error: null,
  })
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
})

describe('SettingsOverlay', () => {
  it('opens on the appearance section and switches sections', async () => {
    const user = userEvent.setup({ delay: null })
    renderOverlay()

    await user.click(await screen.findByRole('button', { name: '打开设置' }))
    const dialog = await screen.findByRole('dialog', { name: '设置' })
    expect(within(dialog).getByRole('heading', { name: '外观' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '交互' }))
    expect(within(dialog).getByRole('heading', { name: '交互' })).toBeInTheDocument()
    expect(within(dialog).getByText('快捷键')).toBeInTheDocument()
    expect(within(dialog).getByText('关闭覆盖层、抽屉或弹层')).toBeInTheDocument()
  })

  it('changes the theme and reports it in the document', async () => {
    const user = userEvent.setup({ delay: null })
    renderOverlay()
    await user.click(await screen.findByRole('button', { name: '打开设置' }))
    const dialog = await screen.findByRole('dialog', { name: '设置' })

    await user.click(within(dialog).getByRole('radio', { name: /TRAE/ }))

    expect(useSettingsStore.getState().settings.themeId).toBe('trae')
    expect(document.documentElement.getAttribute('data-theme')).toBe('trae')
  })

  it('changes the interface scale through the slider', async () => {
    const user = userEvent.setup({ delay: null })
    renderOverlay()
    await user.click(await screen.findByRole('button', { name: '打开设置' }))
    await screen.findByRole('dialog', { name: '设置' })
    await user.click(screen.getByRole('button', { name: '交互' }))

    const slider = screen.getByLabelText('界面缩放')
    await user.click(slider)
    expect(useSettingsStore.getState().settings.uiScale).toBeGreaterThanOrEqual(0.8)
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).not.toBe('')
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup({ delay: null })
    renderOverlay()
    const trigger = await screen.findByRole('button', { name: '打开设置' })
    await user.click(trigger)
    await screen.findByRole('dialog', { name: '设置' })
    await settleOverlay()

    await user.keyboard('{Escape}')

    await waitFor(
      () => expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull(),
      { timeout: 3000 },
    )
    await waitFor(() => expect(trigger).toHaveFocus(), { timeout: 3000 })
  })

  it('keeps Tab inside the panel', async () => {
    const user = userEvent.setup({ delay: null })
    renderOverlay()
    await user.click(await screen.findByRole('button', { name: '打开设置' }))
    await screen.findByRole('dialog', { name: '设置' })
    await settleOverlay()

    await user.tab()
    expect(screen.getByRole('dialog', { name: '设置' }).contains(document.activeElement)).toBe(true)
    for (let press = 0; press < 40; press += 1) {
      await user.tab()
      expect(screen.getByRole('dialog', { name: '设置' }).contains(document.activeElement)).toBe(
        true,
      )
    }
  })

  it('renders honest states for the sections that hold data', async () => {
    const user = userEvent.setup({ delay: null })
    renderOverlay()
    await user.click(await screen.findByRole('button', { name: '打开设置' }))
    const dialog = await screen.findByRole('dialog', { name: '设置' })

    await user.click(within(dialog).getByRole('button', { name: '模型服务' }))
    expect(within(dialog).getAllByText('模型服务未配置').length).toBeGreaterThan(0)
    expect(within(dialog).queryByRole('textbox')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: '数据' }))
    expect(within(dialog).getByText('存储位置')).toBeInTheDocument()
    expect(within(dialog).getByText('备份格式')).toBeInTheDocument()
    // The clear confirmation is hidden behind its own step, so no text box is
    // in the section before the user asks for it.
    expect(within(dialog).queryByRole('textbox')).toBeNull()
  })

  it('shows the build facts in the about section', async () => {
    const user = userEvent.setup({ delay: null })
    renderOverlay()
    await user.click(await screen.findByRole('button', { name: '打开设置' }))
    const dialog = await screen.findByRole('dialog', { name: '设置' })

    await user.click(within(dialog).getByRole('button', { name: '关于' }))

    expect(within(dialog).getByText('0.0.0-test')).toBeInTheDocument()
    expect(within(dialog).getAllByText('浏览器预览').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('MIT')).toBeInTheDocument()
    expect(within(dialog).getByText('数据库')).toBeInTheDocument()
  })
})
