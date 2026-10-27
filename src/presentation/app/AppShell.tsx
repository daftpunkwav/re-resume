/**
 * @file AppShell
 * @description The three-column workbench frame: the sidebar, the conversation
 * region with its header, and the right-hand dock. It owns the responsive
 * layout tier, the global shortcuts and the two overlays the window can show.
 *
 * Responsibilities:
 * - Compose the regions and hand them the layout tier
 * - Register the global shortcuts at one point
 * - Close the drawn-out dock on Escape below the compact breakpoint
 * - Keep the document in step with the operating system's colour scheme
 *
 * Constraints:
 * - No region imports another region's store state beyond what it must; the
 *   shell reads the stores directly, and the regions read their own slices.
 */

import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import {
  clampUiScale,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_NARROW_MAX,
  PANEL_WIDTH_MIN,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
} from '../../domain/settings/AppSettings'
import { ToastRegion } from './components/Toast'
import { ConversationPlaceholder } from './placeholders/ConversationPlaceholder'
import { PanelDock } from './PanelDock'
import { SettingsOverlay } from './settings/SettingsOverlay'
import { useGlobalShortcuts } from './shortcuts'
import { Sidebar } from './Sidebar'
import { useSettingsStore } from './stores/settingsStore'
import { useShellStore } from './stores/shellStore'
import type { FocusDomain } from './stores/shellStore'
import { showToast } from './stores/toastStore'
import { applyAppearance } from './theme/applyAppearance'
import { useLayoutTier } from './useLayoutTier'
import { TopBar } from './TopBar'

/** Below the wide breakpoint two panes would each fall under their minimum. */
const TWO_PANE_MIN_WIDTH = PANEL_WIDTH_MIN * 2

function focusRegion(domain: FocusDomain): void {
  useShellStore.getState().setFocusDomain(domain)
  const region = document.querySelector<HTMLElement>(`[data-region="${domain}"]`)
  region?.focus()
}

export function AppShell() {
  const tier = useLayoutTier()
  const collapsedPreference = useShellStore((state) => state.sidebarCollapsed)
  const rightPanel = useShellStore((state) => state.rightPanel)
  const rightWidth = useShellStore((state) => state.rightWidth)
  const setRightPanel = useShellStore((state) => state.setRightPanel)
  const settingsOpen = useShellStore((state) => state.settingsOpen)

  const collapsed = tier === 'compact' || collapsedPreference
  const maximum = tier === 'wide' ? PANEL_WIDTH_MAX : PANEL_WIDTH_NARROW_MAX
  let renderedWidth = Math.min(rightWidth, maximum)
  if (tier === 'wide' && rightPanel === 'both') {
    renderedWidth = Math.max(renderedWidth, TWO_PANE_MIN_WIDTH)
  }
  const shellStyle = { '--panel-right-width': `${renderedWidth}px` } as CSSProperties

  useGlobalShortcuts({
    newConversation: () => {
      useShellStore.getState().startNewConversation()
      focusRegion('conversation')
    },
    toggleSettings: () => {
      const shell = useShellStore.getState()
      if (shell.settingsOpen) shell.closeSettings()
      else shell.openSettings()
    },
    togglePanel: () => useShellStore.getState().togglePanelVisibility(),
    focusDomain: focusRegion,
    adjustScale: (direction) => {
      const current = useSettingsStore.getState().settings.uiScale
      const next = clampUiScale(current + direction * UI_SCALE_STEP)
      if (next === current) {
        showToast(
          'info',
          direction === 1
            ? `已经是最大缩放 ${Math.round(UI_SCALE_MAX * 100)}%`
            : `已经是最小缩放 ${Math.round(UI_SCALE_MIN * 100)}%`,
        )
        return
      }
      useSettingsStore.getState().update({ uiScale: next })
    },
    resetScale: () => {
      const current = useSettingsStore.getState().settings.uiScale
      if (current === 1) {
        showToast('info', '界面缩放已经是 100%')
        return
      }
      useSettingsStore.getState().update({ uiScale: 1 })
      showToast('info', '界面缩放已恢复 100%')
    },
  })

  // The colour scheme can follow the operating system; a change there has to
  // reach the document even while nothing else about the settings changes.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemSchemeChange = (): void => {
      applyAppearance(useSettingsStore.getState().settings)
    }
    query.addEventListener('change', onSystemSchemeChange)
    return () => query.removeEventListener('change', onSystemSchemeChange)
  }, [])

  // Below the compact breakpoint the dock is drawn over the conversation, so
  // Escape has to take it back. Bubble phase: an overlay above the shell (a
  // dialog, the settings overlay, a popover) handles Escape first and marks
  // the event as handled.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const shell = useShellStore.getState()
      if (shell.settingsOpen) return
      if (tier === 'compact' && shell.rightPanel !== 'none') {
        event.preventDefault()
        shell.setRightPanel('none')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tier])

  return (
    <div className="shell" data-layout={tier} style={shellStyle}>
      {/* While the settings surface is open the workbench behind it is inert
          for assistive technology, which is what makes the overlay a dialog
          rather than a panel drawn over a still-interactive page. */}
      <div className="shell-body" aria-hidden={settingsOpen || undefined}>
        <Sidebar collapsed={collapsed} />
        <main className="workspace">
          <TopBar collapsed={collapsed} />
          <div className="workspace-body">
            <section
              className="conversation region-focus"
              data-region="conversation"
              tabIndex={-1}
              aria-label="简历助手"
              onFocus={() => useShellStore.getState().setFocusDomain('conversation')}
            >
              <ConversationPlaceholder />
            </section>
            {tier === 'compact' && rightPanel !== 'none' ? (
              <div
                className="drawer-scrim"
                role="presentation"
                onMouseDown={() => setRightPanel('none')}
              />
            ) : null}
            <PanelDock tier={tier} />
          </div>
        </main>
      </div>
      <SettingsOverlay />
      <ToastRegion />
    </div>
  )
}
