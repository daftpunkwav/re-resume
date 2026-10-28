/**
 * @file info.spec
 * @description The information panel end to end: module navigation, search,
 * creating an entry through the typed form, and deletion of an entry a resume
 * still references (the reference warning and the explicit confirmation).
 */

import { expect, test } from '@playwright/test'

import { openPanel, openPreview } from './helpers'

test.describe('the information panel', () => {
  test('searches a module and creates an entry through the form', async ({ page }) => {
    await openPreview(page)
    const dock = await openPanel(page, 'info')
    await expect(page.getByRole('combobox', { name: '模块' })).toBeVisible()

    const modulePicker = page.getByRole('combobox', { name: '模块' })
    await expect(modulePicker.locator('option[value="education"]')).toHaveCount(1)
    await modulePicker.selectOption('education')
    const list = page.getByRole('list', { name: '教育经历条目' })
    await expect(list).toBeVisible()
    const entryCountBefore = await list.getByRole('button').count()

    await page.getByRole('textbox', { name: '搜索教育经历' }).fill('复旦')
    await expect(list.getByText('复旦', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '清除搜索' }).click()

    await dock.getByRole('button', { name: '新建', exact: true }).click()
    await expect(dock.getByRole('heading', { name: '新建教育经历' })).toBeVisible()
    await dock.getByRole('button', { name: '添加', exact: true }).click()
    // The validation refuses an empty required field and keeps the form open.
    await expect(page.getByLabel('学校 *')).toBeVisible()

    await page.getByLabel('学校 *').fill('同济大学')
    await page.getByRole('combobox', { name: '学历 *' }).selectOption('bachelor')
    await page.getByLabel('开始时间 *').fill('2017-09')
    await dock.getByRole('button', { name: '添加', exact: true }).click()

    // The narrow layout keeps the created entry open in its saved state; going
    // back to the list shows it there.
    await expect(dock.getByRole('heading', { name: '同济大学（本科）' })).toBeVisible()
    await page.getByRole('button', { name: '返回条目列表' }).click()
    await expect(list.getByText('同济大学（本科）').first()).toBeVisible()
    await expect(list.getByRole('button')).toHaveCount(entryCountBefore + 1)
  })

  test('warns before deleting an entry a resume still references', async ({ page }) => {
    await openPreview(page)
    await openPanel(page, 'info')

    // The personal entry is referenced by the seeded resume chapters.
    await page.getByRole('list', { name: '个人信息条目' }).getByRole('button', { name: /^林清越/ }).click()
    await page.getByRole('button', { name: '删除这条信息' }).click()
    const confirm = page.getByRole('dialog', { name: '删除这条信息？' })
    await expect(confirm).toBeVisible()
    // The first confirmation runs the delete; the use case refuses a referenced
    // entry and the dialog becomes the reference report.
    await confirm.getByRole('button', { name: '删除', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: /这条信息仍被简历引用/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/简历章节正在使用/)).toBeVisible()
    await dialog.getByRole('button', { name: '仍然删除' }).click()

    await expect(page.getByText('已删除「林清越」')).toBeVisible()
    await expect(
      page.getByRole('list', { name: '个人信息条目' }).getByText('林清越', { exact: false }),
    ).toHaveCount(0)
  })
})
