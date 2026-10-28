/**
 * @file shell.spec
 * @description The workbench frame in a real browser: the three-column layout,
 * the two right-hand panels, the settings overlay and the compact drawer.
 */

import { expect, test } from '@playwright/test'

import { openPanel, openPreview, openSettings, startNewConversation } from './helpers'

test.describe('the workbench shell', () => {
  test('opens the stored session and keeps the three regions', async ({ page }) => {
    await openPreview(page)

    await expect(page.getByRole('complementary', { name: '工作台侧边栏' })).toBeVisible()
    await expect(page.getByRole('region', { name: '简历助手' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '为字节跳动前端岗位准备简历' })).toBeVisible()
    // The scripted tool chain answers, so the transcript contains a recorded
    // tool call from the first turn.
    await expect(page.getByRole('button', { name: /更新项目经历/ })).toBeVisible()
  })

  test('keeps the conversation readable when both panels are requested at 1280', async ({ page }) => {
    await openPreview(page)

    const dock = await openPanel(page, 'info')
    await expect(dock.getByRole('heading', { name: '简历信息', exact: true })).toBeVisible()
    await openPanel(page, 'resume')

    // Below the split floor the dock keeps one pane at a time behind the tabs;
    // opening the second panel must not shrink the conversation to a sliver.
    await expect(page.getByRole('tablist', { name: '面板切换' })).toBeVisible()
    await expect(page.getByRole('region', { name: '简历创作' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: '简历信息' })).toHaveCount(0)
    const conversationWidth = await page.evaluate(
      () => document.querySelector('.conversation')?.getBoundingClientRect().width ?? 0,
    )
    expect(conversationWidth).toBeGreaterThanOrEqual(360)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)

    // Switching the tab changes the single visible pane.
    await page.getByRole('tab', { name: '简历信息' }).click()
    await expect(page.getByRole('combobox', { name: '模块' })).toBeVisible()

    // The composer hint is on one line; a squeezed column would wrap it
    // character by character or push it below the controls.
    const hint = page.locator('.composer-hint')
    if (await hint.isVisible()) {
      const box = await hint.boundingBox()
      expect(box?.height ?? 0).toBeLessThan(24)
    }
  })

  test('splits the dock into two panes on a wide window', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await openPreview(page)

    await openPanel(page, 'info')
    await openPanel(page, 'resume')
    await expect(page.getByRole('separator', { name: '调整面板分栏' })).toBeVisible()
    await expect(page.getByRole('region', { name: '简历创作' })).toBeVisible()
    await expect(page.getByRole('region', { name: '简历信息' })).toBeVisible()
    const conversationWidth = await page.evaluate(
      () => document.querySelector('.conversation')?.getBoundingClientRect().width ?? 0,
    )
    expect(conversationWidth).toBeGreaterThanOrEqual(360)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('opens the settings overlay and closes it with Escape', async ({ page }) => {
    await openPreview(page)
    const dialog = await openSettings(page)
    await expect(dialog.getByRole('heading', { name: '外观', exact: true })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    // Focus returns to the control that opened the overlay.
    await expect(page.getByRole('button', { name: /^设置/ })).toBeFocused()
  })

  test('starts an empty session from the sidebar', async ({ page }) => {
    await openPreview(page)
    await startNewConversation(page)
    await expect(page.getByRole('textbox', { name: '输入消息' })).toBeFocused()
    await expect(page.getByRole('button', { name: /导入示例数据/ })).toBeVisible()
  })

  test('boots inside the preview budget with a bounded DOM', async ({ page }, testInfo) => {
    const startedAt = Date.now()
    await openPreview(page)
    await expect(page.getByRole('heading', { name: '为字节跳动前端岗位准备简历' })).toBeVisible()
    const wallClock = Date.now() - startedAt
    const metrics = await page.evaluate(() => {
      const mark = performance.getEntriesByName('boot:interactive')[0]
      const resources = performance.getEntriesByType('resource')
      return {
        bootMark: mark === undefined ? null : Math.round(mark.startTime),
        domNodes: document.querySelectorAll('*').length,
        scriptRequests: resources.filter((entry) => entry.initiatorType === 'script').length,
        transferBytes: resources.reduce((total, entry) => total + entry.transferSize, 0),
      }
    })
    // Preview runs Vite's unbundled development modules, so this asserts the
    // preview stays interactive (and reports the number); the production
    // first-paint budget is measured on the built window. The upper bound here
    // is deliberately loose because CI runs this next to the other browser
    // workers on a shared runner.
    expect(metrics.bootMark).not.toBeNull()
    expect(metrics.bootMark as number).toBeLessThan(6000)
    expect(metrics.domNodes).toBeLessThan(3000)
    await testInfo.attach('boot-metrics', {
      contentType: 'application/json',
      body: JSON.stringify({ ...metrics, wallClock }),
    })
  })

  test('turns the dock into a drawer below the compact breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 })
    await openPreview(page)

    await page.getByRole('button', { name: /^简历信息$/ }).click()
    const dock = page.getByRole('complementary', { name: '右侧面板' })
    await expect(dock).toBeVisible()
    await expect(dock.getByRole('heading', { name: '简历信息', exact: true })).toBeVisible()

    // Below the compact breakpoint the drawer floats over the conversation and
    // Escape takes it back.
    await page.keyboard.press('Escape')
    await expect(dock.getByRole('heading', { name: '简历信息', exact: true })).toHaveCount(0)

    // The document must not scroll horizontally at this size.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
