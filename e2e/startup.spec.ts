/**
 * @file startup.spec
 * @description The first-run flow: the empty conversation offers the sample
 * data entry, importing it rebuilds the window with the seeded library, and the
 * three regions stay usable afterwards.
 */

import { expect, test } from '@playwright/test'

import { openPreview, startNewConversation } from './helpers'

test('imports the sample data from the empty state', async ({ page }) => {
  await openPreview(page)
  await startNewConversation(page)

  const rowsBefore = await page.locator('.conversation-row').count()
  await page.getByRole('button', { name: /导入示例数据/ }).click()
  await expect(page.getByText('示例数据已导入，正在重新加载本地数据')).toBeVisible({ timeout: 15_000 })

  // The rebuild reloads the stored data; the session list keeps the seeded
  // conversations and the library is reachable through the panel.
  await expect(page.getByRole('log', { name: '对话消息' })).toBeVisible({ timeout: 15_000 })
  await expect.poll(async () => page.locator('.conversation-row').count()).toBeGreaterThan(rowsBefore)
  await page.getByRole('button', { name: /^简历信息$/ }).click()
  await expect(page.getByRole('combobox', { name: '模块' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^简历创作$/ })).toBeVisible()
})
