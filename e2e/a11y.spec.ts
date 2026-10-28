/**
 * @file a11y.spec
 * @description Accessibility audit of every core surface with axe, plus the
 * keyboard path through the shell: focus visibility, the settings focus trap and
 * its return, and the theme contrast pairs the design system promises.
 */

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { openPanel, openPreview, openSettings, startNewConversation } from './helpers'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function expectNoViolations(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
    `${surface}: ${results.violations.map((violation) => violation.id).join(', ')}`,
  ).toEqual([])
}

/** WCAG relative luminance contrast between two `rgb()` colours. */
function contrastRatio(foreground: string, background: string): number {
  const parse = (colour: string): number[] => {
    const match = /rgba?\(([^)]+)\)/.exec(colour)
    if (match === null) throw new Error(`not a colour: ${colour}`)
    return match[1]!.split(/[\s,/]+/).slice(0, 3).map(Number)
  }
  const luminance = (colour: string): number => {
    const [r, g, b] = parse(colour).map((value) => {
      const channel = value / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

test.describe('accessibility', () => {
  test.beforeEach(async ({ page }) => {
    // Overlay and panel entrances animate; a scan must see their settled state,
    // not a frame of the transition.
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('the workbench, the transcript and the panels', async ({ page }) => {
    await openPreview(page)
    await expectNoViolations(page, 'workbench')

    await openPanel(page, 'info')
    await expectNoViolations(page, 'information panel')

    await openPanel(page, 'resume')
    await expect(page.getByRole('tab', { name: '组合' })).toBeVisible()
    await expectNoViolations(page, 'resume panel')
  })

  test('the empty conversation with and without a provider', async ({ page }) => {
    await openPreview(page)
    await startNewConversation(page)
    await expectNoViolations(page, 'empty conversation')

    await page.goto('/?preview&providers=none')
    await expect(page.getByRole('log', { name: '对话消息' })).toBeVisible()
    await startNewConversation(page)
    await expect(page.getByText('还没有可用的模型服务')).toBeVisible()
    await expectNoViolations(page, 'empty conversation without a provider')
  })

  test('the settings overlay and the export dialog', async ({ page }) => {
    await openPreview(page)
    const settings = await openSettings(page)
    await expect(settings.getByRole('heading', { name: '外观', exact: true })).toBeVisible()
    await expectNoViolations(page, 'settings overlay')
    await page.keyboard.press('Escape')

    await openPanel(page, 'resume')
    await page.getByRole('button', { name: '导出 PDF' }).click()
    const exportDialog = page.getByRole('dialog', { name: '导出 PDF' })
    await expect(exportDialog.getByText('正在检查排版…')).toHaveCount(0)
    await expectNoViolations(page, 'export dialog')
  })

  test('keeps a visible focus ring and traps it in the settings overlay', async ({ page }) => {
    await openPreview(page)
    await page.keyboard.press('Tab')
    const focused = page.locator(':focus-visible')
    await expect(focused).toBeVisible()
    const outline = await focused.evaluate((element) => {
      const style = getComputedStyle(element)
      return { width: style.outlineStyle === 'none' ? style.boxShadow : style.outlineWidth }
    })
    expect(outline.width).not.toBe('')

    const dialog = await openSettings(page)
    const inside = await dialog.evaluate((element) => element.contains(document.activeElement))
    expect(inside).toBe(true)
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab')
      expect(
        await dialog.evaluate((element) => element.contains(document.activeElement)),
      ).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /^设置/ })).toBeFocused()
  })

  test('keeps the text contrast pairs at WCAG AA in both schemes', async ({ page }) => {
    await openPreview(page)
    for (const scheme of ['light', 'dark'] as const) {
      await page.evaluate((value) => {
        document.documentElement.dataset.colorScheme = value
      }, scheme)
      const pairs = await page.evaluate(() => {
        const read = (name: string): string => {
          const probe = document.createElement('span')
          probe.style.color = `var(${name})`
          document.body.append(probe)
          const colour = getComputedStyle(probe).color
          probe.remove()
          return colour
        }
        const background = (name: string): string => {
          const probe = document.createElement('span')
          probe.style.backgroundColor = `var(${name})`
          document.body.append(probe)
          const colour = getComputedStyle(probe).backgroundColor
          probe.remove()
          return colour
        }
        return [
          { foreground: read('--text-primary'), background: background('--surface-app') },
          { foreground: read('--text-secondary'), background: background('--surface-raised') },
          { foreground: read('--text-primary'), background: background('--surface-conversation') },
        ]
      })
      for (const pair of pairs) {
        expect(contrastRatio(pair.foreground, pair.background)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
