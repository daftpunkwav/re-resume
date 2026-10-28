/**
 * @file previewInfo.test
 * @description The information service the browser preview hands out: it reads
 * the fixture library, searches it, and accepts the same writes the native root
 * would, all against memory.
 */

import { describe, expect, it } from 'vitest'

import { createPreviewRoot } from '../../src/bootstrap/previewRoot'
import {
  PREVIEW_INFO_CUSTOM_MODULES,
  PREVIEW_INFO_ENTRIES,
} from '../../src/infrastructure/preview/fixtures.info'
import { asCustomModuleId, asInfoEntryId } from '../../src/domain/shared/branded-id'

describe('preview information service', () => {
  it('serves the fixture library', async () => {
    const root = createPreviewRoot()
    const library = await root.info.listEntries()

    expect(library.entries).toHaveLength(PREVIEW_INFO_ENTRIES.length)
    expect(library.customModules).toHaveLength(PREVIEW_INFO_CUSTOM_MODULES.length)
    // Eight built-in modules plus the fixture's custom module.
    expect(library.summaries).toHaveLength(9)
    expect(library.entries.some((entry) => entry.moduleKind === 'custom')).toBe(true)
  })

  it('searches the fixture library', async () => {
    const root = createPreviewRoot()
    const result = await root.info.searchEntries({ keyword: '订单' })

    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits[0]?.title).toBe('订单中台重构')
  })

  it('creates, updates and deletes an entry through the facade', async () => {
    const root = createPreviewRoot()
    const before = (await root.info.listEntries()).entries.length

    const created = await root.info.createEntry({
      moduleKind: 'skill',
      fields: { name: 'Rust' },
      origin: 'user',
    })
    expect(created.entry.title).toBe('Rust')
    expect(created.change.label).toBe('新增个人技能：Rust')
    expect((await root.info.listEntries()).entries).toHaveLength(before + 1)

    const updated = await root.info.updateEntry({
      entryId: created.entry.id,
      fields: { name: 'Rust', level: 'familiar' },
    })
    expect(updated.entry.fields.level).toBe('familiar')

    const removed = await root.info.deleteEntry({
      entryId: created.entry.id,
      confirmReferenced: true,
    })
    expect(removed.referencedBy).toEqual([])
    expect((await root.info.listEntries()).entries).toHaveLength(before)
    await expect(root.info.searchEntries({ keyword: 'Rust' })).resolves.toEqual({ hits: [] })
  })

  it('manages a custom module through the facade', async () => {
    const root = createPreviewRoot()
    const created = await root.info.createCustomModule({
      name: '作品集',
      fields: [{ label: '项目', type: 'text', required: true, maxLength: 80 }],
    })
    expect(created.module.name).toBe('作品集')
    expect((await root.info.listEntries()).summaries).toHaveLength(10)

    const updated = await root.info.updateCustomModule({
      moduleId: created.module.id,
      name: '作品',
    })
    expect(updated.module.name).toBe('作品')

    await expect(
      root.info.deleteCustomModule({ moduleId: created.module.id, confirmEntries: true }),
    ).resolves.toMatchObject({ entryCount: 0 })
    expect((await root.info.listEntries()).summaries).toHaveLength(9)
  })

  it('exposes the preview library as a normal root with a shutdown', async () => {
    const root = createPreviewRoot()
    expect(root.appInfo.runtime).toBe('browser')
    const entries = await root.info.listEntries({ moduleKind: 'personal' })
    expect(entries.entries).toHaveLength(1)
    expect(entries.entries[0]?.id).toBe(asInfoEntryId('preview-personal-1'))
    expect((await root.info.listEntries()).customModules[0]?.id).toBe(
      asCustomModuleId('preview-module-certificate'),
    )
    await expect(root.shutdown()).resolves.toBeUndefined()
  })

  it('validates a write the same way the native root does', async () => {
    const root = createPreviewRoot()
    await expect(
      root.info.createEntry({ moduleKind: 'personal', fields: {}, origin: 'user' }),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'blankRequiredField' })
  })
})
