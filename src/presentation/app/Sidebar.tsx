/**
 * @file Sidebar
 * @description The persistent left rail: new-conversation entry, the two view
 * entries that open the right-hand panels, the conversation list slot, and the
 * settings entry with the model-service status.
 *
 * The conversation list itself belongs to the assistant feature (PR-07); the
 * empty state here is what a window with no stored sessions shows.
 */

import { useState } from 'react'
import { Button } from './components/Button'
import { Icon } from './components/Icon'
import { IconButton } from './components/IconButton'
import { ShortcutKeys, primaryModifierLabel } from './components/Kbd'
import { Popover } from './components/Popover'
import { Tooltip } from './components/Tooltip'
import { ConversationList } from '../features/conversation/ConversationList'
import { describeProviderStatus } from './providerStatus'
import { useSettingsStore } from './stores/settingsStore'
import { useShellStore } from './stores/shellStore'
import { useLayoutTier } from './useLayoutTier'

export interface SidebarProps {
  readonly collapsed: boolean
}

export function Sidebar({ collapsed }: SidebarProps) {
  const rightPanel = useShellStore((state) => state.rightPanel)
  const setRightPanel = useShellStore((state) => state.setRightPanel)
  const togglePanel = useShellStore((state) => state.togglePanel)
  const tier = useLayoutTier()
  const toggleSidebar = useShellStore((state) => state.toggleSidebar)
  const startNewConversation = useShellStore((state) => state.startNewConversation)
  const openSettings = useShellStore((state) => state.openSettings)
  const settingsOpen = useShellStore((state) => state.settingsOpen)
  const activeProviderId = useSettingsStore((state) => state.settings.activeProviderId)
  const [statusOpen, setStatusOpen] = useState(false)

  const status = describeProviderStatus(activeProviderId)
  const infoVisible = rightPanel === 'info' || rightPanel === 'both'
  const resumeVisible = rightPanel === 'resume' || rightPanel === 'both'
  // Below the compact breakpoint the dock is a drawer that shows one panel at a
  // time, so the entries select rather than compose a two-pane dock.
  const selectPanel = (panel: 'info' | 'resume'): void => {
    if (tier !== 'compact') {
      togglePanel(panel)
      return
    }
    setRightPanel(rightPanel === panel ? 'none' : panel)
  }

  return (
    <aside
      className={collapsed ? 'sidebar sidebar-collapsed' : 'sidebar'}
      aria-label="工作台侧边栏"
      data-region="sidebar"
      tabIndex={-1}
    >
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          R
        </span>
        {collapsed ? null : <span className="brand-name">ReResume</span>}
        {collapsed ? null : (
          <IconButton
            icon="chevrons-left"
            label="收起侧边栏"
            size="small"
            className="sidebar-collapse"
            onClick={toggleSidebar}
          />
        )}
      </div>

      <div className="sidebar-primary">
        <Button
          variant="primary"
          icon="plus"
          block={!collapsed}
          iconOnly={collapsed}
          aria-label={collapsed ? '新建对话' : undefined}
          onClick={() => {
            startNewConversation()
            const region = document.querySelector<HTMLElement>('[data-region="conversation"]')
            region?.focus()
          }}
        >
          {collapsed ? undefined : '新建对话'}
        </Button>
      </div>

      <nav className="sidebar-nav" aria-label="工作台视图">
        <Tooltip label="简历信息" placement="top">
          <button
            type="button"
            className={infoVisible ? 'sidebar-item sidebar-item-active' : 'sidebar-item'}
            aria-label="简历信息"
            aria-pressed={infoVisible}
            aria-controls="panel-dock"
            aria-expanded={infoVisible}
            onClick={() => selectPanel('info')}
          >
            <Icon name="id-card" size={16} />
            {collapsed ? null : <span className="sidebar-item-label">简历信息</span>}
          </button>
        </Tooltip>
        <Tooltip label="简历创作" placement="top">
          <button
            type="button"
            className={resumeVisible ? 'sidebar-item sidebar-item-active' : 'sidebar-item'}
            aria-label="简历创作"
            aria-pressed={resumeVisible}
            aria-controls="panel-dock"
            aria-expanded={resumeVisible}
            onClick={() => selectPanel('resume')}
          >
            <Icon name="pen" size={16} />
            {collapsed ? null : <span className="sidebar-item-label">简历创作</span>}
          </button>
        </Tooltip>
      </nav>

      <div className="sidebar-conversations">
        {collapsed ? null : <p className="sidebar-section-label">对话</p>}
        <ConversationList collapsed={collapsed} />
      </div>

      <div className="sidebar-foot">
        <div className="popover-anchor">
          <button
            type="button"
            className="sidebar-item"
            aria-label={status.label}
            aria-haspopup="dialog"
            aria-expanded={statusOpen}
            onClick={() => setStatusOpen((open) => !open)}
          >
            <span className={`status-dot status-dot-${status.tone}`} aria-hidden="true" />
            {collapsed ? null : <span className="sidebar-item-label">{status.label}</span>}
          </button>
          <Popover
            open={statusOpen}
            label="模型服务状态"
            align="start"
            onClose={() => setStatusOpen(false)}
          >
            <p className="popover-title">{status.label}</p>
            <p className="popover-body">{status.detail}</p>
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                setStatusOpen(false)
                openSettings('model')
              }}
            >
              打开模型服务设置
            </Button>
          </Popover>
        </div>
        <Tooltip label="设置" placement="top">
          <button
            type="button"
            className="sidebar-item sidebar-settings"
            aria-label={`设置 ${primaryModifierLabel()} + ,`}
            aria-current={settingsOpen ? 'page' : undefined}
            onClick={() => openSettings()}
          >
            <Icon name="settings" size={16} />
            {collapsed ? null : (
              <>
                <span className="sidebar-item-label">设置</span>
                {/* Decorative: the visible shortcut hint must not change the
                    button's accessible name ("设置"). */}
                <span aria-hidden="true">
                  <ShortcutKeys keys={[primaryModifierLabel(), ',']} />
                </span>
              </>
            )}
          </button>
        </Tooltip>
      </div>
    </aside>
  )
}
