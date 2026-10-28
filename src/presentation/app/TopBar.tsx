/**
 * @file TopBar
 * @description The header of the conversation region: the session title, the
 * model-service state, and the two switches for the right-hand panels.
 *
 * The title is a neutral placeholder until the assistant feature (PR-07)
 * stores sessions; the model chip opens the model section of the settings
 * overlay, which is where that state is explained.
 */

import { IconButton } from './components/IconButton'
import { describeProviderStatus } from './providerStatus'
import { useSettingsStore } from './stores/settingsStore'
import { useShellStore } from './stores/shellStore'

export interface TopBarProps {
  /** True when the sidebar is showing as icons only. */
  readonly collapsed: boolean
}

export function TopBar({ collapsed }: TopBarProps) {
  const rightPanel = useShellStore((state) => state.rightPanel)
  const togglePanel = useShellStore((state) => state.togglePanel)
  const toggleSidebar = useShellStore((state) => state.toggleSidebar)
  const openSettings = useShellStore((state) => state.openSettings)
  const activeProviderId = useSettingsStore((state) => state.settings.activeProviderId)
  const status = describeProviderStatus(activeProviderId)

  const infoVisible = rightPanel === 'info' || rightPanel === 'both'
  const resumeVisible = rightPanel === 'resume' || rightPanel === 'both'

  return (
    <header className="topbar">
      <div className="topbar-leading">
        {collapsed ? (
          <IconButton
            icon="panel-left"
            label="展开侧边栏"
            size="small"
            onClick={toggleSidebar}
          />
        ) : null}
        <h1 className="topbar-title">新对话</h1>
        <span className="topbar-note">尚未开始</span>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="model-chip"
          onClick={() => openSettings('model')}
          aria-label={`${status.label}，打开模型服务设置`}
        >
          <span className={`status-dot status-dot-${status.tone}`} aria-hidden="true" />
          <span className="model-chip-label">{status.label}</span>
        </button>
        <span className="topbar-divider" aria-hidden="true" />
        <IconButton
          icon="id-card"
          label="简历信息面板"
          pressed={infoVisible}
          onClick={() => togglePanel('info')}
        />
        <IconButton
          icon="pen"
          label="简历创作面板"
          pressed={resumeVisible}
          onClick={() => togglePanel('resume')}
        />
      </div>
    </header>
  )
}
