/**
 * @file themes
 * @description The theme catalogue. Each entry pairs an id with the swatches
 * the appearance picker draws, so adding a palette is one object plus one CSS
 * block. The identifiers and the colour-scheme preference live in the domain
 * settings model; this module is the presentation-side catalogue for them.
 */

import { THEME_IDS, isThemeId } from '../../../domain/settings/AppSettings'
import type { ColorScheme, ColorSchemePreference, ThemeId } from '../../../domain/settings/AppSettings'

export { THEME_IDS, isThemeId }
export type { ColorScheme, ColorSchemePreference, ThemeId }

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
    swatch: { light: '#f5f5f7', dark: '#14171c', accent: '#007aff' },
  },
  {
    id: 'doubao',
    label: '豆包',
    description: '清爽蓝白、柔和的层次与长尾缓动',
    swatch: { light: '#f7f8fa', dark: '#14181e', accent: '#0065fd' },
  },
  {
    id: 'google',
    label: 'Google',
    description: '方正的直角、语义四色与低饱和界面',
    swatch: { light: '#f1f3f4', dark: '#202124', accent: '#1a73e8' },
  },
  {
    id: 'minimalist',
    label: '极简',
    description: '近乎无彩、小圆角、以边框代替阴影',
    swatch: { light: '#fafafa', dark: '#101010', accent: '#171717' },
  },
  {
    id: 'trae',
    label: 'TRAE',
    description: '开发者工作台的紧凑密度与靛紫强调色',
    swatch: { light: '#f4f4f5', dark: '#141416', accent: '#4b3fe3' },
  },
]

export function resolveColorScheme(preference: ColorSchemePreference): ColorScheme {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
