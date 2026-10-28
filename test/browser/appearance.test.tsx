/**
 * @file appearance.test
 * @description The appearance application as a browser resolves it: the theme
 * attributes reach the cascade, the scale multiplies the type sizes, the four
 * surfaces are distinct in both schemes, and reduced motion is honoured.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/domain/settings/AppSettings'
import { applyAppearance } from '../../src/presentation/app/theme/applyAppearance'
import '../../src/presentation/styles'

/** The colour a token produces once the cascade has resolved it. */
function resolvedColour(token: string): string {
  const probe = document.createElement('div')
  probe.style.color = `var(${token})`
  document.body.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

function setScheme(colorScheme: 'light' | 'dark', themeId: 'apple' | 'trae' = 'apple'): void {
  applyAppearance({ ...DEFAULT_APP_SETTINGS, themeId, colorScheme })
}

afterEach(() => {
  const root = document.documentElement
  for (const attribute of ['data-theme', 'data-color-scheme', 'data-density', 'data-motion']) {
    root.removeAttribute(attribute)
  }
  root.style.removeProperty('--ui-scale')
  root.style.removeProperty('--density')
})

describe('appearance in a browser', () => {
  it('resolves the four surfaces to distinct tones in the dark scheme', () => {
    setScheme('dark', 'trae')

    const surfaces = [
      resolvedColour('--surface-app'),
      resolvedColour('--surface-conversation'),
      resolvedColour('--surface-panel'),
      resolvedColour('--surface-raised'),
    ]

    expect(new Set(surfaces).size).toBe(4)
    for (const surface of surfaces) {
      expect(surface).not.toBe('rgb(0, 0, 0)')
    }
  })

  it('resolves a visible hairline in both schemes', () => {
    setScheme('light')
    const light = resolvedColour('--border-subtle')
    setScheme('dark')
    const dark = resolvedColour('--border-subtle')

    expect(light).not.toBe('rgba(0, 0, 0, 0)')
    expect(dark).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('multiplies the type scale by the interface scale', () => {
    applyAppearance({ ...DEFAULT_APP_SETTINGS, uiScale: 1.25 })

    const body = getComputedStyle(document.body)
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.25')
    expect(body.fontSize).toBe('16.25px')
  })

  it('honours the reduced-motion preference through the data attribute', () => {
    const probe = document.createElement('button')
    probe.style.transition = 'color 200ms'
    document.body.append(probe)
    applyAppearance({ ...DEFAULT_APP_SETTINGS, motion: 'reduced' })

    expect(durationInMilliseconds(getComputedStyle(probe).transitionDuration)).toBeLessThan(1)
    probe.remove()
  })
})

/**
 * A computed time may be reported as `0.01ms` or as seconds (`1e-05s`), and
 * both are the same near-zero duration the reduced-motion rule sets.
 */
function durationInMilliseconds(value: string): number {
  return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000
}
