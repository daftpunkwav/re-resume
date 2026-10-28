/**
 * @file settings.spec
 * @description Appearance and interaction settings in a real browser: the theme
 * and the interface scale apply immediately, the first-paint cache carries them
 * across a reload, reduced motion reaches the document, and the global shortcuts
 * open the same surfaces as the buttons.
 */

import { expect, test } from '@playwright/test'

import { cachedSettings, openPreview, openSettings, rootVariable } from './helpers'

test.describe('settings and appearance', () => {
  test('applies theme and scale and persists them to the first-paint cache', async ({ page }) => {
    await openPreview(page)
    const dialog = await openSettings(page)

    await dialog.getByRole('radio', { name: '深色' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark')
    let cache = await cachedSettings(page)
    expect(cache?.colorScheme).toBe('dark')

    // The motion switch belongs to the appearance section; the scale lives in
    // the interaction section.
    await dialog.getByRole('switch', { name: '减少界面动效' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')

    await dialog.getByRole('button', { name: '交互' }).click()
    const scale = await rootVariable(page, '--ui-scale')
    const slider = dialog.getByLabel('界面缩放')
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(async () => await rootVariable(page, '--ui-scale'))
      .not.toBe(scale)
    cache = await cachedSettings(page)
    expect(cache?.uiScale).not.toBeCloseTo(1, 2)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('keeps the first paint on the cached scheme after a reload', async ({ page }) => {
    await openPreview(page)
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('reresume.settings.cache.v2')
      const settings = raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>)
      window.localStorage.setItem(
        'reresume.settings.cache.v2',
        JSON.stringify({ ...settings, colorScheme: 'dark' }),
      )
    })
    await page.addInitScript(() => {
      const history: string[] = []
      ;(window as unknown as { __schemeHistory: string[] }).__schemeHistory = history
      // The init script runs before the document element exists, so the theme
      // attribute is recorded at its source: the writes the appearance code
      // performs while booting.
      const original = Element.prototype.setAttribute
      Element.prototype.setAttribute = function setAttribute(
        this: Element,
        name: string,
        value: string,
      ): void {
        if (name === 'data-color-scheme') history.push(value)
        original.call(this, name, value)
      }
    })
    await page.reload()
    await expect(page.getByRole('log', { name: '对话消息' })).toBeVisible()
    const history = await page.evaluate(
      () => (window as unknown as { __schemeHistory: string[] }).__schemeHistory,
    )
    // The cached scheme is applied before the database value arrives; the
    // preview fixture then restores the light default, so the history proves the
    // first paint was dark without depending on the memory database surviving a
    // reload.
    expect(history).toContain('dark')
  })

  test('opens settings and a new conversation from the keyboard', async ({ page }) => {
    await openPreview(page)
    await page.keyboard.press('Control+,')
    const dialog = page.getByRole('dialog', { name: '设置' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.keyboard.press('Control+n')
    await expect(page.getByRole('heading', { name: '从一段对话开始' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '输入消息' })).toBeFocused()
  })
})
