/**
 * @file themes
 * @description The theme catalogue. Each entry pairs an id with the swatches
 * the picker draws, so adding a palette is one object plus one CSS block.
 */

export const THEME_IDS = ['apple', 'doubao', 'google', 'minimalist', 'trae'] as const

export type ThemeId = (typeof THEME_IDS)[number]

export const COLOR_SCHEMES = ['light', 'dark'] as const

export type ColorScheme = (typeof COLOR_SCHEMES)[number]

/** 'system' follows the operating system until the user picks a side. */
export type ColorSchemePreference = ColorScheme | 'system'

export interface ThemeDescriptor {
  readonly id: ThemeId
  readonly label: string
  readonly description: string
  /** Surfaces and accent, used to paint the picker swatch. */
  readonly swatch: {
    readonly light: string
    readonly dark: string
    readonly accent: string
  }
}

export const THEMES: readonly ThemeDescriptor[] = [
  {
    id: 'apple',
    label: 'Apple',
    description: '大圆角、胶囊按钮与克制的发丝分隔线',
    swatch: { light: '#f5f5f7', dark: '#1c1c1e', accent: '#007aff' },
  },
  {
    id: 'doubao',
    label: '豆包',
    description: '清爽蓝白、柔和的层次与长尾缓动',
    swatch: { light: '#f7f8fa', dark: '#171a1f', accent: '#0065fd' },
  },
  {
    id: 'google',
    label: 'Google',
    description: '方正的直角、语义四色与低饱和界面',
    swatch: { light: '#f1f3f4', dark: '#292a2d', accent: '#1a73e8' },
  },
  {
    id: 'minimalist',
    label: '极简',
    description: '近乎无彩、小圆角、以边框代替阴影',
    swatch: { light: '#f5f5f5', dark: '#171717', accent: '#171717' },
  },
  {
    id: 'trae',
    label: 'TRAE',
    description: '开发者工作台的紧凑密度与靛紫强调色',
    swatch: { light: '#f4f4f5', dark: '#1e1e1e', accent: '#4b3fe3' },
  },
]

export const DEFAULT_THEME_ID: ThemeId = 'apple'

export function isThemeId(raw: string): raw is ThemeId {
  return (THEME_IDS as readonly string[]).includes(raw)
}

export function resolveColorScheme(preference: ColorSchemePreference): ColorScheme {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
