/**
 * @file shellStore.test
 * @description The four panel combinations, the persisted width and the
 * settings overlay state. The panel preferences are written back through the
 * settings store, which is the only writer of that value.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import {
  nextPanelMode,
  useShellStore,
} from '../../../../src/presentation/app/stores/shellStore'
import { useSettingsStore } from '../../../../src/presentation/app/stores/settingsStore'

beforeEach(() => {
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
})

describe('nextPanelMode', () => {
  it('opens the panel that was used from the closed state', () => {
    expect(nextPanelMode('none', 'resume')).toBe('resume')
    expect(nextPanelMode('none', 'info')).toBe('info')
  })

  it('opens the other panel next to the one already open', () => {
    expect(nextPanelMode('resume', 'info')).toBe('both')
    expect(nextPanelMode('info', 'resume')).toBe('both')
  })

  it('closes only the panel that was used when both are open', () => {
    expect(nextPanelMode('both', 'resume')).toBe('info')
    expect(nextPanelMode('both', 'info')).toBe('resume')
  })

  it('closes a panel that is used again', () => {
    expect(nextPanelMode('resume', 'resume')).toBe('none')
    expect(nextPanelMode('info', 'info')).toBe('none')
  })
})

describe('useShellStore', () => {
  it('toggles the panels through their combinations', () => {
    const store = useShellStore.getState()

    store.togglePanel('resume')
    expect(useShellStore.getState().rightPanel).toBe('resume')

    store.togglePanel('info')
    expect(useShellStore.getState().rightPanel).toBe('both')

    store.togglePanel('info')
    expect(useShellStore.getState().rightPanel).toBe('resume')

    store.togglePanel('resume')
    expect(useShellStore.getState().rightPanel).toBe('none')
  })

  it('brings the last combination back with the visibility toggle', () => {
    useShellStore.getState().togglePanel('info')
    useShellStore.getState().togglePanelVisibility()
    expect(useShellStore.getState().rightPanel).toBe('none')

    useShellStore.getState().togglePanelVisibility()
    expect(useShellStore.getState().rightPanel).toBe('info')
  })

  it('clamps a committed width to the legal range and stores it', () => {
    useShellStore.getState().setRightWidth(5000)
    expect(useShellStore.getState().rightWidth).toBe(720)

    useShellStore.getState().setRightWidth(10)
    expect(useShellStore.getState().rightWidth).toBe(320)

    useShellStore.getState().setRightWidth(700, 420)
    expect(useShellStore.getState().rightWidth).toBe(420)
    expect(useSettingsStore.getState().settings.panels.rightWidth).toBe(420)
  })

  it('writes the panel preferences back through the settings store', () => {
    useShellStore.getState().togglePanel('resume')

    expect(useSettingsStore.getState().settings.panels).toEqual({
      right: 'resume',
      rightWidth: 400,
      collapsed: false,
    })
  })

  it('opens the settings overlay on the requested section', () => {
    useShellStore.getState().openSettings('data')
    expect(useShellStore.getState().settingsOpen).toBe(true)
    expect(useShellStore.getState().settingsSection).toBe('data')

    useShellStore.getState().setSettingsSection('about')
    expect(useShellStore.getState().settingsSection).toBe('about')

    useShellStore.getState().closeSettings()
    expect(useShellStore.getState().settingsOpen).toBe(false)
  })

  it('hydrates the stored preferences and replays a new conversation', () => {
    useShellStore.getState().hydrate({
      right: 'both',
      rightWidth: 520,
      collapsed: true,
    })
    expect(useShellStore.getState()).toMatchObject({
      rightPanel: 'both',
      rightWidth: 520,
      sidebarCollapsed: true,
    })

    const before = useShellStore.getState().draftEpoch
    useShellStore.getState().startNewConversation()
    expect(useShellStore.getState().draftEpoch).toBe(before + 1)
    expect(useShellStore.getState().focusDomain).toBe('conversation')
  })
})
