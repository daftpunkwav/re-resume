/**
 * @file backup.test
 * @description The application side of backup: the document round trip
 * (including attachment bytes), the refusal that leaves the current data
 * untouched, clearing, and the orphan sweep.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  cleanupOrphanAttachments,
  cutoffBefore,
} from '../../../src/application/settings/cleanupOrphanAttachments'
import { clearAllData } from '../../../src/application/settings/clearAllData'
import { base64ToBytes, exportBackup } from '../../../src/application/settings/exportBackup'
import { importBackup, inspectBackup } from '../../../src/application/settings/importBackup'
import type { OrphanAttachment } from '../../../src/domain/backup/ports/BackupStore'
import type { Clock } from '../../../src/domain/shared/Clock'
import { InMemorySecretStore } from '../../../src/infrastructure/preview/inMemoryRepositories'
import type { DateTime } from '../../../src/domain/shared/DateTime'
import {
  backupDocument,
  InMemoryBackupStore,
  tablesWithRows,
  TEST_TIMESTAMP,
  TestFileStore,
} from '../../../test/support/backupFixtures'

const ATTACHMENT_ROW = {
  id: 'a1',
  kind: 'image',
  mime_type: 'image/png',
  byte_size: 4,
  storage_name: 'image-1.png',
  width: 1,
  height: 1,
  sha256: 'a'.repeat(64),
  created_at: TEST_TIMESTAMP,
}

const SETTINGS_ROW = {
  id: 'default',
  settings_json: JSON.stringify({
    themeId: 'apple',
    colorScheme: 'system',
    density: 'comfortable',
    motion: 'system',
    uiScale: 1,
    canvasZoom: 1,
    panels: { right: 'none', rightWidth: 400, collapsed: false },
    sampleDataSeeded: false,
    lastConversationId: null,
    activeProviderId: null,
  }),
  updated_at: TEST_TIMESTAMP,
}

const clock: Clock = { now: () => TEST_TIMESTAMP as DateTime }


describe('exportBackup', () => {
  it('reads the tables and the attachment bytes into one document', async () => {
    const store = new InMemoryBackupStore(
      tablesWithRows({ app_settings: [SETTINGS_ROW], attachment: [ATTACHMENT_ROW] }),
    )
    const files = new TestFileStore()
    files.files.set('image-1.png', new Uint8Array([1, 2, 3, 4]))

    const document = await exportBackup({ backup: store, files, clock })

    expect(document.tables.app_settings).toHaveLength(1)
    expect(document.attachments).toHaveLength(1)
    expect(base64ToBytes(document.attachments[0]?.bytesBase64 ?? '')).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    )
  })

  it('fails when an attachment row has no file, rather than dropping it', async () => {
    const store = new InMemoryBackupStore(
      tablesWithRows({ app_settings: [SETTINGS_ROW], attachment: [ATTACHMENT_ROW] }),
    )

    await expect(exportBackup({ backup: store, files: new TestFileStore(), clock })).rejects.toThrow(
      /image-1.png/,
    )
  })
})

describe('importBackup', () => {
  it('restores a document it exported, including the attachment bytes', async () => {
    const sourceFiles = new TestFileStore()
    sourceFiles.files.set('image-1.png', new Uint8Array([1, 2, 3, 4]))
    const source = new InMemoryBackupStore(
      tablesWithRows({ app_settings: [SETTINGS_ROW], attachment: [ATTACHMENT_ROW] }),
    )
    const document = await exportBackup({ backup: source, files: sourceFiles, clock })

    const targetFiles = new TestFileStore()
    const target = new InMemoryBackupStore()
    const summary = await importBackup(
      { backup: target, files: targetFiles, secrets: new InMemorySecretStore() },
      document,
    )

    expect(summary.tables.attachment).toBe(1)
    expect(target.tables.attachment).toEqual([ATTACHMENT_ROW])
    expect(targetFiles.files.get('image-1.png')).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('refuses a malformed document without touching the current data', async () => {
    const target = new InMemoryBackupStore(tablesWithRows({ app_settings: [SETTINGS_ROW] }))
    const files = new TestFileStore()
    const bad = { ...backupDocument(), schemaVersion: 3 }

    await expect(
      importBackup({ backup: target, files, secrets: new InMemorySecretStore() }, bad),
    ).rejects.toThrow(/schema version/)
    expect(target.calls).not.toContain('replaceAll')
    expect(target.tables.app_settings).toHaveLength(1)
  })

  it('inspects without writing', () => {
    const document = backupDocument(tablesWithRows({ app_settings: [SETTINGS_ROW] }))

    const summary = inspectBackup(document)

    expect(summary.tables.app_settings).toBe(1)
  })
})

describe('clearAllData', () => {
  it('clears the database first and then the files', async () => {
    const store = new InMemoryBackupStore(tablesWithRows({ app_settings: [SETTINGS_ROW] }))
    const names = ['one.png', 'two.png']
    const files = new TestFileStore()
    names.forEach((name) => files.files.set(name, new Uint8Array([1])))
    store.listAttachmentStorageNames = async () => names

    const result = await clearAllData({ backup: store, files, secrets: new InMemorySecretStore() })

    expect(result.removedAttachments).toBe(2)
    expect(store.calls[0]).toBe('clearAll')
    expect(files.files.size).toBe(0)
  })
})

describe('cleanupOrphanAttachments', () => {
  it('deletes the rows and files the store reports as orphaned', async () => {
    const orphan: OrphanAttachment = { id: 'a1', storageName: 'old.png' }
    const deleted: string[] = []
    const backup = new InMemoryBackupStore()
    backup.listOrphanAttachments = vi.fn(async () => [orphan])
    backup.deleteAttachments = vi.fn(async (ids: readonly string[]) => {
      deleted.push(...ids)
    })
    const files = new TestFileStore()
    files.files.set('old.png', new Uint8Array([1]))

    const result = await cleanupOrphanAttachments({ backup, files, clock })

    expect(result.removed).toBe(1)
    expect(deleted).toEqual(['a1'])
    expect(files.files.size).toBe(0)
  })

  it('only looks at attachments older than a day', () => {
    expect(Date.parse(cutoffBefore(TEST_TIMESTAMP))).toBe(
      Date.parse(TEST_TIMESTAMP) - 24 * 60 * 60 * 1000,
    )
  })
})

describe('credentials and the data operations', () => {
  it('forgets the credential of every provider a restore brings back', async () => {
    const secrets = new InMemorySecretStore([['provider:p1', 'old-key']])
    const target = new InMemoryBackupStore()
    const document = backupDocument(tablesWithRows({ provider_config: [{
  id: 'p1',
  name: 'Gateway',
  kind: 'openai-compatible',
  base_url: 'https://api.example.com/v1',
  model_id: 'model-1',
  secret_ref: 'provider:p1',
  supports_images: null,
  is_active: 1,
  created_at: TEST_TIMESTAMP,
  updated_at: TEST_TIMESTAMP,
}] }))

    await importBackup({ backup: target, files: new TestFileStore(), secrets }, document)

    await expect(secrets.load('provider:p1')).resolves.toBeNull()
  })

  it('forgets provider credentials when clearing all data', async () => {
    const secrets = new InMemorySecretStore([['provider:p1', 'old-key']])
    const store = new InMemoryBackupStore()
    store.listProviderSecretRefs = async () => ['provider:p1']

    const result = await clearAllData({ backup: store, files: new TestFileStore(), secrets })

    expect(result.removedSecrets).toBe(1)
    await expect(secrets.load('provider:p1')).resolves.toBeNull()
  })
})
