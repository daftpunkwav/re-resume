/**
 * @file conversation.spec
 * @description The assistant main flow in a real browser: the scripted tool
 * chain paints cards during the turn, a recorded write can be undone, a slow
 * answer can be stopped, and a failed turn reports the failure with retry.
 */

import { expect, test } from '@playwright/test'

import { openPreview, sendMessage } from './helpers'

test.describe('the conversation flow', () => {
  test('streams the tool chain, shows the cards and undoes a recorded write', async ({ page }) => {
    await openPreview(page)
    await sendMessage(page, '帮我按字节跳动的岗位整理项目经历')

    const writeCard = page.getByRole('button', { name: /更新项目经历/ })
    await expect(writeCard).toBeVisible()
    await expect(
      page.getByRole('log', { name: '对话消息' }).getByText(/整理|简历/).first(),
    ).toBeVisible({ timeout: 15_000 })

    await writeCard.click()
    await expect(page.getByText(/原始内容仍可撤销/)).toBeVisible()
    await page.getByRole('button', { name: /撤销此项/ }).click()
    await expect(page.getByText('已撤销').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /撤销此项/ })).toHaveCount(0)
  })

  test('stops a streaming answer and keeps the partial text', async ({ page }) => {
    await openPreview(page, 'slow')
    await sendMessage(page, '写一段项目经历')
    const stop = page.getByRole('button', { name: /停止/ })
    await expect(stop).toBeVisible()
    await expect(page.getByText('正在生成回答').first()).toBeVisible()

    await stop.click()
    await expect(page.getByText('已取消').first()).toBeVisible({ timeout: 15_000 })
    // The partial answer is stored, not thrown away.
    await expect(page.locator('.message-user-text').last()).toBeVisible()
  })

  test('reports a failed turn with a retry entry', async ({ page }) => {
    await openPreview(page, 'failure')
    await sendMessage(page, '整理一下项目章节')
    await expect(page.getByText('这次操作没有完成')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: '重试' }).first()).toBeVisible()
    await expect(page.getByText(/模型服务返回 503/).first()).toBeVisible()
  })

  test('has no console errors during the main flow', async ({ page }) => {
    const errors = await openPreview(page)
    await sendMessage(page, '你好')
    await expect(page.getByRole('log', { name: '对话消息' }).getByText('你好')).toBeVisible()
    await expect
      .poll(() => errors.filter((message) => !message.includes('favicon')), {
        message: 'the main flow logged console errors',
      })
      .toEqual([])
  })
})
