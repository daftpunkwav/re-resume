/**
 * @file emptyState.spec
 * @description The new-conversation surface at both target sizes. The welcome
 * screen is taller when no model service is configured (it carries the warning
 * block), so this spec asserts the composer stays inside the window for both
 * variants and that a send still creates the conversation.
 */

import { expect, test, type Page } from '@playwright/test'

import { startNewConversation, sendMessage } from './helpers'

async function openEmpty(page: Page, providers: 'configured' | 'none'): Promise<void> {
  const query = providers === 'none' ? '&providers=none' : ''
  await page.goto(`/?preview${query}`)
  await expect(page.getByRole('log', { name: '对话消息' })).toBeVisible()
  await startNewConversation(page)
}

function composerBottomGap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const composer = document.querySelector('.composer')
    if (composer === null) throw new Error('the composer is missing')
    return window.innerHeight - composer.getBoundingClientRect().bottom
  })
}

test.describe('the empty conversation', () => {
  for (const viewport of [
    { width: 1280, height: 840 },
    { width: 960, height: 640 },
  ]) {
    test(`keeps the composer in view without a provider at ${viewport.width.toString()}x${viewport.height.toString()}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await openEmpty(page, 'none')

      await expect(page.getByText('还没有可用的模型服务')).toBeVisible()
      await expect(page.getByRole('button', { name: /导入示例数据/ })).toBeVisible()
      expect(await composerBottomGap(page)).toBeGreaterThanOrEqual(0)

      await sendMessage(page, '先检查一下我的简历信息')
      // The turn exists even while the provider configuration is empty; the
      // warning is about the model service, not about the local conversation.
      await expect(page.getByRole('log', { name: '对话消息' }).getByText('先检查一下我的简历信息')).toBeVisible()
    })
  }

  test('keeps the composer in view with the configured provider', async ({ page }) => {
    await openEmpty(page, 'configured')
    await expect(page.getByText('还没有可用的模型服务')).toHaveCount(0)
    expect(await composerBottomGap(page)).toBeGreaterThanOrEqual(0)
  })
})
