/**
 * @file SettingsOverlay
 * @description The full-window settings surface. It covers the workbench
 * without unmounting it, so closing it returns to the same conversation state.
 *
 * Responsibilities:
 * - Render the section navigation and the active section
 * - Trap the keyboard while open, close on Escape and scrim click, and hand
 *   focus back to the element that opened it
 * - Report a settings value that could not be read or stored
 *
 * Constraints:
 * - The overlay is a surface over the shell, not a route: there is no router.
 */

import type { ReactNode } from 'react'
import type { AppInfo } from '../../../bootstrap/capabilities'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { Notice } from '../components/Notice'
import { usePresence } from '../usePresence'
import { useFocusTrap } from '../useFocusTrap'
import { useServices } from '../ApplicationServicesProvider'
import { useSettingsStore } from '../stores/settingsStore'
import { SETTINGS_SECTIONS, useShellStore } from '../stores/shellStore'
import type { SettingsSectionId } from '../stores/shellStore'
import { AboutSection } from './AboutSection'
import { AppearanceSection } from './AppearanceSection'
import { DataSection } from './DataSection'
import { InteractionSection } from './InteractionSection'
import { ProviderSection } from './ProviderSection'
import { SETTINGS_SECTION_META } from './settingsSections'

/** How long the panel takes to leave; the presence hook keeps it mounted. */
const EXIT_MS = 180

function sectionContent(section: SettingsSectionId, appInfo: AppInfo): ReactNode {
  switch (section) {
    case 'appearance':
      return <AppearanceSection />
    case 'interaction':
      return <InteractionSection />
    case 'model':
      return <ProviderSection />
    case 'data':
      return <DataSection appInfo={appInfo} />
    case 'about':
      return <AboutSection appInfo={appInfo} />
  }
}

export function SettingsOverlay() {
  const { appInfo } = useServices()
  const open = useShellStore((state) => state.settingsOpen)
  const section = useShellStore((state) => state.settingsSection)
  const setSection = useShellStore((state) => state.setSettingsSection)
  const close = useShellStore((state) => state.closeSettings)
  const status = useSettingsStore((state) => state.status)
  const error = useSettingsStore((state) => state.error)
  const clearError = useSettingsStore((state) => state.clearError)

  const { mounted, closing } = usePresence(open, EXIT_MS)
  const panelRef = useFocusTrap<HTMLDivElement>({
    active: mounted && !closing,
    onEscape: close,
  })

  if (!mounted) return null

  const meta = SETTINGS_SECTION_META[section]

  return (
    <div
      className={closing ? 'settings-overlay settings-overlay-closing' : 'settings-overlay'}
    >
      <div
        className="settings-scrim"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      />
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        tabIndex={-1}
        ref={panelRef}
      >
        <nav className="settings-nav" aria-label="设置分节">
          <div className="settings-nav-head">
            <span className="settings-nav-title">设置</span>
            <IconButton icon="close" label="关闭设置" size="small" onClick={close} />
          </div>
          <ul className="settings-nav-list">
            {SETTINGS_SECTIONS.map((id) => {
              const item = SETTINGS_SECTION_META[id]
              const active = id === section
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={active ? 'settings-nav-item settings-nav-item-active' : 'settings-nav-item'}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setSection(id)}
                  >
                    <Icon name={item.icon} size={16} />
                    <span>{item.navLabel}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="settings-nav-foot">
            <span>ReResume {appInfo.version}</span>
            <span>{appInfo.runtime === 'tauri' ? '桌面容器' : '浏览器预览'}</span>
          </div>
        </nav>

        <div className="settings-content">
          <header className="settings-content-head">
            <h2 className="settings-content-title">{meta.title}</h2>
            <p className="settings-content-description">{meta.description}</p>
          </header>
          <div className="settings-scroll">
            {status === 'unavailable' ? (
              <Notice tone="warning" title="设置未能从数据库读取">
                <p>当前显示的是首帧缓存。新的改动仍会尝试保存。</p>
              </Notice>
            ) : null}
            {error === null ? null : (
              <Notice
                tone="danger"
                title="设置没有保存"
                actions={
                  <Button size="small" variant="ghost" onClick={clearError}>
                    知道了
                  </Button>
                }
              >
                <p>{error.message}</p>
              </Notice>
            )}
            {sectionContent(section, appInfo)}
          </div>
        </div>
      </div>
    </div>
  )
}
