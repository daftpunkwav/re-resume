/**
 * @file AppShell
 * @description The window frame: persistent navigation on the left, the active
 * region on the right, and the appearance controls that follow the user rather
 * than a settings page.
 */

import { AppearanceControls } from './components/AppearanceControls'
import { Icon } from './components/Icon'
import type { IconName } from './components/Icon'
import { useNavigation } from './navigationStore'
import type { AppSection } from './navigationStore'
import { ExperienceWorkspace } from '../features/experience/ExperienceWorkspace'
import { ResumeWorkspace } from '../features/resume/ResumeWorkspace'
import { SettingsView } from '../features/settings/SettingsView'

interface NavItem {
  readonly id: AppSection
  readonly label: string
  readonly hint: string
  readonly icon: IconName
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'experience', label: '经历库', hint: '积累真实经历与表述', icon: 'library' },
  { id: 'resume', label: '简历', hint: '组合、排版与定稿', icon: 'document' },
  { id: 'settings', label: '设置', hint: '个人资料与模型服务', icon: 'settings' },
]

export function AppShell() {
  const section = useNavigation((state) => state.section)
  const showSection = useNavigation((state) => state.showSection)
  const active = NAV_ITEMS.find((item) => item.id === section)

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="主导航">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span className="brand-name">ReResume</span>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === section ? 'nav-item nav-item-active' : 'nav-item'}
                aria-current={item.id === section ? 'page' : undefined}
                onClick={() => showSection(item.id)}
              >
                <Icon name={item.icon} size={16} />
                <span className="nav-item-body">
                  <span className="nav-item-label">{item.label}</span>
                  <span className="nav-item-hint">{item.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="sidebar-foot">
          <AppearanceControls />
        </div>
      </nav>

      <main className="content">
        <header className="content-head">
          <h1 className="content-title">{active?.label ?? ''}</h1>
          <p className="content-subtitle">{active?.hint ?? ''}</p>
        </header>
        <div className="content-body">
          {section === 'experience' ? <ExperienceWorkspace /> : null}
          {section === 'resume' ? <ResumeWorkspace /> : null}
          {section === 'settings' ? <SettingsView /> : null}
        </div>
      </main>
    </div>
  )
}
