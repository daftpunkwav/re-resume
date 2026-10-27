/**
 * @file applyAppearance.test
 * @description What a settings value writes onto the document. The stylesheets
 * select on these attributes and read the two multipliers, so this is the whole
 * bridge between a preference and what the window paints.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../../../src/domain/settings/AppSettings'
import { applyAppearance } from '../../../../src/presentation/app/theme/applyAppearance'

afterEach(() => {
  const root = document.documentElement
  for (const attribute of ['data-theme', 'data-color-scheme', 'data-density', 'data-motion']) {
    root.removeAttribute(attribute)
  }
  root.style.removeProperty('--ui-scale')
  root.style.removeProperty('--density')
})

describe('applyAppearance', () => {
  it('writes the theme, scheme, density and motion preferences', () => {
    applyAppearance({
      ...DEFAULT_APP_SETTINGS,
      themeId: 'doubao',
      colorScheme: 'dark',
      density: 'compact',
      motion: 'reduced',
      uiScale: 1.25,
    })

    const root = document.documentElement
    expect(root.getAttribute('data-theme')).toBe('doubao')
    expect(root.getAttribute('data-color-scheme')).toBe('dark')
    expect(root.getAttribute('data-density')).toBe('compact')
    expect(root.getAttribute('data-motion')).toBe('reduced')
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.25')
    expect(root.style.getPropertyValue('--density')).toBe('0.85')
  })

  it('resolves the system scheme through the media query', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('dark'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia

    try {
      applyAppearance({ ...DEFAULT_APP_SETTINGS, colorScheme: 'system' })
      expect(document.documentElement.getAttribute('data-color-scheme')).toBe('dark')
    } finally {
      window.matchMedia = original
    }
  })
})
