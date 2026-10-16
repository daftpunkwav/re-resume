/**
 * @file AppearanceControls
 * @description Theme and colour-scheme picker for the title bar. Both choices
 * apply immediately and persist; nothing here needs a save button.
 */

import { THEMES } from '../theme/themes'
import type { ColorSchemePreference } from '../theme/themes'
import { useAppearance } from '../theme/useAppearance'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const SCHEME_OPTIONS: readonly {
  readonly id: ColorSchemePreference
  readonly label: string
  readonly icon: IconName
}[] = [
  { id: 'light', label: '浅色', icon: 'sun' },
  { id: 'dark', label: '深色', icon: 'moon' },
  { id: 'system', label: '跟随系统', icon: 'monitor' },
]

export function AppearanceControls() {
  const themeId = useAppearance((state) => state.themeId)
  const colorSchemePreference = useAppearance((state) => state.colorSchemePreference)
  const setTheme = useAppearance((state) => state.setTheme)
  const setColorSchemePreference = useAppearance((state) => state.setColorSchemePreference)

  return (
    <div className="appearance">
      <div className="appearance-themes" role="radiogroup" aria-label="主题">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={theme.id === themeId}
            title={`${theme.label} · ${theme.description}`}
            className={theme.id === themeId ? 'theme-chip theme-chip-active' : 'theme-chip'}
            onClick={() => setTheme(theme.id)}
          >
            <span
              className="theme-chip-swatch"
              style={{ background: theme.swatch.light }}
              aria-hidden="true"
            />
            <span
              className="theme-chip-swatch theme-chip-swatch-dark"
              style={{ background: theme.swatch.dark }}
              aria-hidden="true"
            />
            <span className="theme-chip-accent" style={{ background: theme.swatch.accent }} />
          </button>
        ))}
      </div>
      <div className="appearance-schemes" role="radiogroup" aria-label="明暗模式">
        {SCHEME_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === colorSchemePreference}
            className={
              option.id === colorSchemePreference
                ? 'scheme-chip scheme-chip-active'
                : 'scheme-chip'
            }
            onClick={() => setColorSchemePreference(option.id)}
          >
            <Icon name={option.icon} size={14} />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
