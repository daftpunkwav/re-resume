/**
 * @file shellStore
 * @description The view state machine of the workbench: which panels are open,
 * how wide the dock is, whether the settings overlay is showing, and which
 * region the keyboard is in. There is no router; this store is what decides
 * what the window shows.
 *
 * Responsibilities:
 * - Toggle the two right-hand panels through their four combinations
 * - Hold the dock width while it is being dragged, and persist the settled value
 * - Own the settings overlay and its current section
 * - Move the keyboard focus domain for the focus shortcuts
 *
 * Constraints:
 * - Panel preferences live in AppSettings; this store mirrors them for the
 *   window and writes changes back through the settings store, which is the
 *   only writer of that value.
 */

import { create } from 'zustand'
import type { PanelMode, PanelPreferences } from '../../../domain/settings/AppSettings'
import { clampPanelWidth, PANEL_WIDTH_MAX } from '../../../domain/settings/AppSettings'
import { useSettingsStore } from './settingsStore'

export const SETTINGS_SECTIONS = ['appearance', 'interaction', 'model', 'data', 'about'] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]

export type FocusDomain = 'sidebar' | 'conversation' | 'panel'

interface ShellState {
  readonly rightPanel: PanelMode
  readonly rightWidth: number
  readonly sidebarCollapsed: boolean
  readonly settingsOpen: boolean
  readonly settingsSection: SettingsSectionId
  readonly focusDomain: FocusDomain
  /** Increments when a new conversation is started; replays the empty state. */
  readonly draftEpoch: number
  /** The combination the dock returns to when it is reopened. */
  readonly lastOpenPanel: 'resume' | 'info' | 'both'
  /** Opens or closes one panel without disturbing the other. */
  togglePanel(panel: 'resume' | 'info'): void
  /** Closes the dock, or brings back the combination that was open. */
  togglePanelVisibility(): void
  setRightPanel(mode: PanelMode): void
  setRightWidth(width: number, maximum?: number): void
  setSidebarCollapsed(collapsed: boolean): void
  toggleSidebar(): void
  /** Resets the conversation region to its starting state and focuses it. */
  startNewConversation(): void
  openSettings(section?: SettingsSectionId): void
  closeSettings(): void
  setSettingsSection(section: SettingsSectionId): void
  setFocusDomain(domain: FocusDomain): void
  /** Applies the stored panel preferences after the settings value is adopted. */
  hydrate(preferences: PanelPreferences): void
}

/**
 * The next combination when one panel's entry is used. With both panels open,
 * using one entry closes only that panel; otherwise both entries open both.
 */
export function nextPanelMode(current: PanelMode, panel: 'resume' | 'info'): PanelMode {
  if (current === panel) return 'none'
  if (current === 'none') return panel
  if (current === 'both') return panel === 'resume' ? 'info' : 'resume'
  return 'both'
}

function persistPanels(preferences: PanelPreferences): void {
  useSettingsStore.getState().update({ panels: preferences })
}

export const useShellStore = create<ShellState>((set, get) => ({
  rightPanel: 'none',
  rightWidth: 400,
  sidebarCollapsed: false,
  settingsOpen: false,
  settingsSection: 'appearance',
  focusDomain: 'conversation',
  draftEpoch: 0,
  lastOpenPanel: 'resume',

  togglePanel(panel) {
    const right = nextPanelMode(get().rightPanel, panel)
    set({
      rightPanel: right,
      lastOpenPanel: right === 'none' ? get().lastOpenPanel : right,
    })
    persistPanels({ right, rightWidth: get().rightWidth, collapsed: get().sidebarCollapsed })
  },

  togglePanelVisibility() {
    const current = get().rightPanel
    if (current === 'none') {
      const right = get().lastOpenPanel
      set({ rightPanel: right })
      persistPanels({ right, rightWidth: get().rightWidth, collapsed: get().sidebarCollapsed })
      return
    }
    set({ rightPanel: 'none', lastOpenPanel: current })
    persistPanels({ right: 'none', rightWidth: get().rightWidth, collapsed: get().sidebarCollapsed })
  },

  setRightPanel(mode) {
    set({
      rightPanel: mode,
      lastOpenPanel: mode === 'none' ? get().lastOpenPanel : mode,
    })
    persistPanels({ right: mode, rightWidth: get().rightWidth, collapsed: get().sidebarCollapsed })
  },

  setRightWidth(width, maximum) {
    const limit = maximum ?? PANEL_WIDTH_MAX
    const rightWidth = clampPanelWidth(width, limit)
    set({ rightWidth })
    persistPanels({
      right: get().rightPanel,
      rightWidth,
      collapsed: get().sidebarCollapsed,
    })
  },

  setSidebarCollapsed(collapsed) {
    set({ sidebarCollapsed: collapsed })
    persistPanels({ right: get().rightPanel, rightWidth: get().rightWidth, collapsed })
  },

  toggleSidebar() {
    get().setSidebarCollapsed(!get().sidebarCollapsed)
  },

  startNewConversation() {
    set({ draftEpoch: get().draftEpoch + 1, focusDomain: 'conversation' })
  },

  openSettings(section) {
    set({
      settingsOpen: true,
      settingsSection: section ?? get().settingsSection,
    })
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  setSettingsSection(section) {
    set({ settingsSection: section })
  },

  setFocusDomain(domain) {
    set({ focusDomain: domain })
  },

  hydrate(preferences) {
    set({
      rightPanel: preferences.right,
      rightWidth: clampPanelWidth(preferences.rightWidth),
      sidebarCollapsed: preferences.collapsed,
      lastOpenPanel: preferences.right === 'none' ? get().lastOpenPanel : preferences.right,
    })
  },
}))
