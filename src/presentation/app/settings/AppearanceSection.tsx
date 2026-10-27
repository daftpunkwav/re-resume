/**
 * @file AppearanceSection
 * @description Theme, colour scheme, density and motion. Every control writes
 * the settings store, which applies the change immediately and stores it after
 * a short debounce.
 *
 * The accent colour is not a choice here: the interface accent comes from the
 * selected theme, and a resume's accent colour belongs to that resume's
 * appearance.
 */

import type { Density } from '../../../domain/settings/AppSettings'
import { SegmentedControl } from '../components/SegmentedControl'
import { SelectField } from '../components/SelectField'
import { Switch } from '../components/Switch'
import { useSettingsStore } from '../stores/settingsStore'
import { THEMES } from '../theme/themes'

const SCHEME_OPTIONS = [
  { id: 'system', label: '跟随系统', icon: 'monitor' },
  { id: 'light', label: '浅色', icon: 'sun' },
  { id: 'dark', label: '深色', icon: 'moon' },
] as const

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: '舒适' },
  { value: 'compact', label: '紧凑' },
] as const

export function AppearanceSection() {
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const selectedTheme = THEMES.find((theme) => theme.id === settings.themeId) ?? THEMES[0]

  return (
    <div className="settings-section">
      <section className="settings-group">
        <h3 className="settings-group-title">主题</h3>
        <p className="settings-group-description">主题决定配色与形状语言，界面强调色也随之确定。</p>
        <div className="theme-options" role="radiogroup" aria-label="主题">
          {THEMES.map((theme) => {
            const selected = theme.id === settings.themeId
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? 'theme-option theme-option-selected' : 'theme-option'}
                onClick={() => update({ themeId: theme.id })}
              >
                <span className="theme-option-preview" aria-hidden="true">
                  <span
                    className="theme-option-surface"
                    style={{
                      background:
                        theme.swatch[settings.colorScheme === 'dark' ? 'dark' : 'light'],
                    }}
                  />
                  <span
                    className="theme-option-accent"
                    style={{ background: theme.swatch.accent }}
                  />
                </span>
                <span className="theme-option-label">{theme.label}</span>
              </button>
            )
          })}
        </div>
        {selectedTheme === undefined ? null : (
          <p className="settings-group-description">{selectedTheme.description}</p>
        )}
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">外观模式</h3>
        <p className="settings-group-description">跟随系统时，窗口随操作系统的浅色或深色设置切换。</p>
        <SegmentedControl
          label="外观模式"
          options={SCHEME_OPTIONS}
          value={settings.colorScheme}
          onChange={(colorScheme) => update({ colorScheme })}
        />
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">界面</h3>
        <div className="settings-grid">
          <SelectField
            label="界面密度"
            value={settings.density}
            options={DENSITY_OPTIONS}
            hint="紧凑模式缩小控件与行高，适合小窗口。"
            onChange={(event) => update({ density: event.target.value as Density })}
          />
        </div>
        <Switch
          label="减少界面动效"
          description="关闭面板与覆盖层的位移动画，保留淡入淡出。"
          checked={settings.motion === 'reduced'}
          onChange={(checked) => update({ motion: checked ? 'reduced' : 'system' })}
        />
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">强调色</h3>
        <div className="settings-accent">
          <span className="accent-preview" aria-hidden="true" />
          <p className="settings-group-description">
            界面强调色由主题决定。每份简历的强调色在创作面板中单独设置，两者互不影响。
          </p>
        </div>
      </section>
    </div>
  )
}
