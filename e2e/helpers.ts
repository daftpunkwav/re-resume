/**
 * @file helpers
 * @description Shared entry points for the end-to-end specs. The preview window
 * answers every capability over memory, so each spec starts from the same
 * deterministic fixtures and reaches the same flows a user does.
 */

import { expect, type Locator, type Page } from '@playwright/test'

export type Replay = 'tools' | 'slow' | 'failure' | 'plain'

export interface OpenedPreview {
  /** Console errors and page errors raised while the spec runs. */
  readonly errors: readonly string[]
}

/**
 * Opens the workbench against the preview assembly and waits for its first
 * frame. `?script=` selects the scripted model replay; `tools` (the default)
 * runs the full tool chain, `slow` pauses between chunks, `failure` ends with a
 * provider error and `plain` answers with plain text.
 */
export async function openPreview(page: Page, replay: Replay = 'tools'): Promise<string[]> {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  await page.goto(`/?preview&script=${replay}`)
  await expect(page.getByRole('log', { name: '对话消息' })).toBeVisible()
  return errors
}

/** Starts an empty session through the sidebar entry. */
export async function startNewConversation(page: Page): Promise<void> {
  await page.getByRole('button', { name: '新建对话' }).click()
  await expect(page.getByRole('heading', { name: '从一段对话开始' })).toBeVisible()
}

/** Opens one of the two right-hand panels through the sidebar entry. */
export async function openPanel(page: Page, panel: 'info' | 'resume'): Promise<Locator> {
  const label = panel === 'info' ? '简历信息' : '简历创作'
  await page.getByRole('button', { name: new RegExp(`^${label}$`) }).click()
  return page.getByRole('complementary', { name: '右侧面板' })
}

/** Opens the settings overlay through the sidebar entry. */
export async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^设置/ }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Sends one message through the composer with the keyboard. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: '输入消息' })
  await composer.fill(text)
  await composer.press('Enter')
}

/** A settings value read from the first-paint cache rather than the database. */
export async function cachedSettings(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('reresume.settings.cache.v2')
    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>)
  })
}

/** The resolved value of a CSS custom property on the document root. */
export async function rootVariable(page: Page, name: string): Promise<string> {
  return page.evaluate((variable) => {
    return getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  }, name)
}
