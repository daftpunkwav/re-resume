/**
 * @file focusIndicator.test
 * @description The focus indicator of the dialog panel, read from what a
 * browser paints. The component test reads the declaration the stylesheet
 * carries, because jsdom neither applies the outline shorthand nor resolves a
 * custom property against the theme. This test loads the stylesheets the
 * window loads and reads the outline the focused panel is painted with.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Dialog } from '../../src/presentation/app/components/Dialog'
import { applyAppearance } from '../../src/presentation/app/theme/useAppearance'
import type { ColorScheme, ThemeId } from '../../src/presentation/app/theme/themes'
import '../../src/presentation/styles'

/** The outline the panel that holds the focus is painted with. */
interface Ring {
  readonly width: string
  readonly style: string
  readonly offset: string
  readonly colour: string
}

const noop = (): void => undefined

/**
 * The ring of the panel, with the theme loaded. The dialog is opened the way
 * the application opens it: the focus lands on the panel, and the ring says
 * so. The panel is unmounted again, so one test can read the ring of two
 * themes.
 */
function ringOf(themeId: ThemeId, colorScheme: ColorScheme): Ring {
  applyAppearance(themeId, colorScheme)
  const { unmount } = render(
    <Dialog open title="定稿这份简历" onConfirm={noop} onClose={noop} />,
  )
  const panel = screen.getByRole('dialog')
  expect(document.activeElement).toBe(panel)

  const computed = getComputedStyle(panel)
  const ring: Ring = {
    width: computed.outlineWidth,
    style: computed.outlineStyle,
    offset: computed.outlineOffset,
    colour: computed.outlineColor,
  }
  unmount()
  return ring
}

/**
 * The accent of the loaded theme, resolved the way the browser resolves it.
 * A custom property keeps its own notation and a colour does not, so the ring
 * is compared with the colour the token produces rather than with the token.
 */
function accentColour(): string {
  const probe = document.createElement('span')
  probe.style.color = 'var(--accent)'
  document.body.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

describe('the focus indicator of the dialog panel', () => {
  it('paints the ring the panel carries', () => {
    const ring = ringOf('trae', 'dark')

    expect(ring.width).toBe('2px')
    expect(ring.style).toBe('solid')
    // The ring stands off the panel, so it does not touch the text inside it.
    expect(ring.offset).toBe('2px')
    // The ring is painted in the accent of the theme that is loaded.
    expect(ring.colour).toBe(accentColour())
  })

  it('follows the palette of the theme that is loaded', () => {
    // Each theme is checked against its own accent: a ring that took another
    // colour would still differ from the ring of the other theme, so the
    // comparison against the token is what says which colour the ring has.
    const light = ringOf('apple', 'light')
    expect(light.colour).toBe(accentColour())

    const dark = ringOf('trae', 'dark')
    expect(dark.colour).toBe(accentColour())

    // The two themes have different accents, so the ring is not one colour.
    expect(light.colour).not.toBe(dark.colour)
  })

  it('paints the ring only while the panel holds the focus', () => {
    applyAppearance('trae', 'dark')
    render(
      <>
        <button type="button">打开</button>
        <Dialog open title="定稿这份简历" onConfirm={noop} onClose={noop} />
      </>,
    )
    const panel = screen.getByRole('dialog')
    expect(getComputedStyle(panel).outlineStyle).toBe('solid')

    screen.getByRole('button', { name: '打开' }).focus()

    // The ring is the indicator of the focus, so it leaves with it.
    expect(getComputedStyle(panel).outlineStyle).toBe('none')
  })
})
