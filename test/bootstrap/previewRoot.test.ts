/**
 * @file previewRoot.test
 * @description The browser preview answers the same contract as the native
 * root: it reports itself as a browser session, reads the fixture preferences,
 * stores changes, and shuts down without a native container.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { createPreviewRoot } from '../../src/bootstrap/previewRoot'
import { PREVIEW_SETTINGS } from '../../src/infrastructure/preview/fixtures'
import { PANEL_WIDTH_MAX } from '../../src/domain/settings/AppSettings'

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as { version: string }
).version

describe('createPreviewRoot', () => {
  it('reports a browser session with the package version', () => {
    const root = createPreviewRoot()

    expect(root.appInfo.runtime).toBe('browser')
    expect(root.appInfo.databaseFile).toBeNull()
    expect(root.appInfo.version).toBe(PACKAGE_VERSION)
    expect(root.appInfo.license).toBe('Apache-2.0')
  })

  it('reads the fixture preferences', async () => {
    const root = createPreviewRoot()
    await expect(root.settings.read()).resolves.toEqual(PREVIEW_SETTINGS)
  })

  it('stores a change with the same clamping as the native root', async () => {
    const root = createPreviewRoot()

    const saved = await root.settings.save({
      panels: { right: 'both', rightWidth: 5000, collapsed: false },
    })

    expect(saved.panels.rightWidth).toBe(PANEL_WIDTH_MAX)
    await expect(root.settings.read()).resolves.toEqual(saved)
  })

  it('provides a working credential store', async () => {
    const root = createPreviewRoot()

    await root.secrets.store('provider:one', 'secret-value')

    await expect(root.secrets.load('provider:one')).resolves.toBe('secret-value')
    await root.secrets.remove('provider:one')
    await expect(root.secrets.load('provider:one')).resolves.toBeNull()
  })

  it('serves the conversation area from memory', async () => {
    const root = createPreviewRoot()

    const listed = await root.conversation.listConversations()
    expect(listed.conversations).toHaveLength(3)
    expect(listed.groups.today.length + listed.groups.last7Days.length).toBeGreaterThan(0)
    const messages = await root.conversation.listMessages(listed.conversations[0]!.id, 10)
    expect(messages.length).toBeGreaterThan(0)
  })

  it('shuts down without a native container', async () => {
    const root = createPreviewRoot()
    await expect(root.shutdown()).resolves.toBeUndefined()
  })
})
