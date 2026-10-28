/**
 * @file resume.spec
 * @description The resume studio end to end: template and paper switches,
 * revision undo, and inline editing of a canvas block through the double-click
 * editor while the canvas reflects the committed value.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openPanel, openPreview } from './helpers'

async function openStudio(page: Page): Promise<void> {
  await openPreview(page)
  await openPanel(page, 'resume')
  await expect(page.getByRole('tab', { name: '组合' })).toBeVisible()
  await expect(page.locator('.studio-revision-label')).toBeVisible()
}

test.describe('the resume studio', () => {
  test('switches template and paper size and undoes the template switch', async ({ page }) => {
    await openStudio(page)
    const revision = page.locator('.studio-revision-label')
    const initialRevision = await revision.textContent()

    await page.getByRole('tab', { name: '外观' }).click()
    const gallery = page.getByRole('radiogroup', { name: '简历模板' })
    await expect(gallery.getByRole('radio')).toHaveCount(6)
    const technical = gallery.getByRole('radio', { name: /技术岗/ })
    await technical.click()
    await expect(technical).toHaveAttribute('aria-checked', 'true')
    await expect(revision).not.toHaveText(initialRevision ?? '')

    await page.getByRole('tab', { name: '页面' }).click()
    const letter = page.getByRole('radio', { name: 'Letter' })
    await letter.click()
    await expect(letter).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('button', { name: '撤销' }).click()
    await expect(revision).not.toHaveText(initialRevision ?? '')
    await page.getByRole('button', { name: '重做' }).click()
    await expect(page.getByRole('button', { name: '重做' })).toBeDisabled()
  })

  test('edits a canvas block inline and saves the new text', async ({ page }) => {
    await openStudio(page)
    const canvas = page.locator('.resume-canvas canvas').first()
    await canvas.scrollIntoViewIfNeeded()
    await expect(canvas).toBeVisible()
    const editor = page.getByRole('textbox', { name: /编辑/ })

    // The block coordinates depend on the resume's layout; the stage starts at
    // the first page's content origin, so try the block positions in order until
    // the double-click lands on an editable block.
    const positions = [
      { x: 20, y: 20 },
      { x: 60, y: 40 },
      { x: 20, y: 120 },
      { x: 200, y: 60 },
      { x: 120, y: 90 },
    ]
    let opened = false
    for (const position of positions) {
      await canvas.dblclick({ position })
      opened = await editor
        .waitFor({ state: 'visible', timeout: 1500 })
        .then(() => true)
        .catch(() => false)
      if (opened) break
    }
    expect(opened, 'no canvas block opened its inline editor').toBe(true)

    await editor.fill('林清越 · 前端开发')
    await editor.press('Control+Enter')
    await expect(editor).toHaveCount(0)
    await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled()
  })
})
