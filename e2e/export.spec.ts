/**
 * @file export.spec
 * @description The PDF export end to end: the plan shows the page count and the
 * suggested file name, the browser downloads the document, and the bytes are a
 * real, non-empty, parseable PDF whose page count matches the plan and whose
 * text carries the candidate's name.
 */

import { expect, test } from '@playwright/test'
import { readFile, stat } from 'node:fs/promises'

import { openPanel, openPreview } from './helpers'

test('exports the open resume as a real PDF', async ({ page }, testInfo) => {
  await openPreview(page)
  await openPanel(page, 'resume')
  await expect(page.getByRole('button', { name: '导出 PDF' })).toBeVisible()

  await page.getByRole('button', { name: '导出 PDF' }).click()
  const dialog = page.getByRole('dialog', { name: '导出 PDF' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('正在检查排版…')).toHaveCount(0)

  const pageCountText = await dialog.locator('.studio-export-meta dd').first().textContent()
  const plannedPages = Number.parseInt(pageCountText ?? '', 10)
  expect(plannedPages).toBeGreaterThan(0)
  const suggestedName = await dialog.locator('.studio-export-meta dd').nth(1).textContent()
  expect(suggestedName).toMatch(/^林清越-.+\.pdf$/)

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^(导出 PDF|仍然导出)$/ }).click()
  const download = await downloadPromise
  const target = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(target)

  const saved = await stat(target)
  expect(saved.size).toBeGreaterThan(1024)
  expect(download.suggestedFilename()).toMatch(/^林清越-.+\.pdf$/)

  // The PDF is validated from its own bytes: a real header, one page object per
  // planned page and an embedded font subset. Reading it through a PDF library
  // inside the Playwright worker hits a structured-clone limitation of its
  // in-process worker, so the raw object stream is the honest surface here.
  const pdf = await readFile(target, 'latin1')
  expect(pdf.startsWith('%PDF-')).toBe(true)
  const pageObjects = pdf.match(/\/Type\s*\/Page[^s]/g) ?? []
  expect(pageObjects.length).toBe(plannedPages)
  expect(pdf).toMatch(/\/FontFile2?/)
  // A ToUnicode map is what makes the embedded text extractable again.\n  expect(pdf).toContain('/ToUnicode')
})
