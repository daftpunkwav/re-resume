/**
 * @file backupFixtures
 * @description Values shared by the backup tests: an empty but valid document,
 * a memory backup store, and a memory attachment store. Every table is present
 * because the document contract requires the whole schema, even when empty.
 */

import {
  BACKUP_APP_MARKER,
  BACKUP_DOCUMENT_VERSION,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
} from '../../src/domain/backup/BackupDocument'
import type {
  BackupAttachment,
  BackupDocument,
  BackupRow,
  BackupTables,
} from '../../src/domain/backup/BackupDocument'
import type { BackupStore, OrphanAttachment } from '../../src/domain/backup/ports/BackupStore'
import type { FileStore } from '../../src/domain/conversation/ports/FileStore'
import type { DateTime } from '../../src/domain/shared/DateTime'

export const TEST_TIMESTAMP = '2026-01-01T00:00:00.000Z' as DateTime

export function emptyTables(): BackupTables {
  return Object.fromEntries(BACKUP_TABLES.map((table) => [table, [] as BackupRow[]]))
}

export function tablesWithRows(
  rows: Readonly<Record<string, readonly BackupRow[]>>,
): BackupTables {
  return { ...emptyTables(), ...rows }
}

export function backupDocument(
  tables: BackupTables = emptyTables(),
  attachments: readonly BackupAttachment[] = [],
): BackupDocument {
  return {
    v: BACKUP_DOCUMENT_VERSION,
    app: BACKUP_APP_MARKER,
    exportedAt: TEST_TIMESTAMP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    tables,
    attachments,
  }
}

export class InMemoryBackupStore implements BackupStore {
  tables: BackupTables
  readonly deletedAttachmentIds: string[] = []
  readonly calls: string[] = []

  constructor(tables: BackupTables = emptyTables()) {
    this.tables = tables
  }

  async dumpTables(): Promise<BackupTables> {
    this.calls.push('dumpTables')
    return structuredClone(this.tables)
  }

  async replaceAll(tables: BackupTables): Promise<void> {
    this.calls.push('replaceAll')
    this.tables = structuredClone(tables)
  }

  async clearAll(): Promise<void> {
    this.calls.push('clearAll')
    this.tables = emptyTables()
  }

  async listOrphanAttachments(_createdBefore: DateTime): Promise<readonly OrphanAttachment[]> {
    this.calls.push('listOrphanAttachments')
    return []
  }

  async deleteAttachments(ids: readonly string[]): Promise<void> {
    this.calls.push('deleteAttachments')
    this.deletedAttachmentIds.push(...ids)
  }

  async listAttachmentStorageNames(): Promise<readonly string[]> {
    return []
  }

  async listProviderSecretRefs(): Promise<readonly string[]> {
    return []
  }
}

export class TestFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>()
  readonly deleted: string[] = []

  async write(storageName: string, bytes: Uint8Array): Promise<void> {
    this.files.set(storageName, bytes)
  }

  async read(storageName: string): Promise<Uint8Array> {
    const bytes = this.files.get(storageName)
    if (bytes === undefined) throw new Error(`No file ${storageName}`)
    return bytes
  }

  async delete(storageName: string): Promise<void> {
    this.deleted.push(storageName)
    this.files.delete(storageName)
  }

  async list(): Promise<readonly string[]> {
    return [...this.files.keys()]
  }
}
