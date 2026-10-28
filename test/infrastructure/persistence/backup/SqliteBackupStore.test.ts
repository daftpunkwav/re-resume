/**
 * @file SqliteBackupStore.test
 * @description The native backup port against a real SQLite database: a dump
 * restores into a fresh schema, clearing removes everything, and the orphan
 * sweep only names attachments nothing refers to.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BACKUP_TABLES } from '../../../../src/domain/backup/BackupDocument'
import type { BackupRow } from '../../../../src/domain/backup/BackupDocument'
import { SqliteBackupStore } from '../../../../src/infrastructure/persistence/backup/SqliteBackupStore'
import {
  createMigratedDatabase,
  foreignKeyViolations,
} from '../../../../test/support/nodeSqliteDatabase'
import type { NodeSqliteDatabase } from '../../../../test/support/nodeSqliteDatabase'

const TIMESTAMP = '2026-01-01T00:00:00.000Z'

const SETTINGS_JSON = JSON.stringify({
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
})

function insertRows(database: NodeSqliteDatabase, table: string, sql: string): void {
  database.execScript(sql)
  expect(table.length).toBeGreaterThan(0)
}

function seedRows(database: NodeSqliteDatabase): void {
  insertRows(
    database,
    'app_settings',
    `INSERT INTO app_settings (id, settings_json, updated_at)
     VALUES ('default', '${SETTINGS_JSON.replaceAll("'", "''")}', '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'provider_config',
    `INSERT INTO provider_config
       (id, name, kind, base_url, model_id, secret_ref, supports_images, is_active, created_at, updated_at)
     VALUES ('p1', 'Gateway', 'openai-compatible', 'https://api.example.com/v1', 'model-1',
             'provider:p1', 0, 1, '${TIMESTAMP}', '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'custom_module',
    `INSERT INTO custom_module (id, name, fields_json, sort_order, created_at, updated_at)
     VALUES ('m1', 'Open source', '[]', 1, '${TIMESTAMP}', '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'info_entry',
    `INSERT INTO info_entry
       (id, module_kind, custom_module_id, title, fields_json, sort_order, origin, source_run_id, created_at, updated_at)
     VALUES ('e1', 'custom', 'm1', 'Entry', '{"title":"Entry"}', 1, 'user', NULL,
             '${TIMESTAMP}', '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'change_record',
    `INSERT INTO change_record
       (id, scope, entity, entity_id, op, before_json, after_json, origin, run_id, conversation_id, label, undone_at, created_at)
     VALUES ('c1', 'library', 'infoEntry', 'e1', 'infoEntry.create', NULL, '{}', 'user',
             NULL, NULL, 'create', NULL, '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'conversation',
    `INSERT INTO conversation (id, title, provider_id, model_id, pinned, active_resume_id,
       summary, summary_through_seq, created_at, updated_at)
     VALUES ('conv1', 'Chat', NULL, NULL, 0, NULL, NULL, NULL, '${TIMESTAMP}', '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'message',
    `INSERT INTO message (id, conversation_id, seq, kind, status, markdown, tool_json,
       run_id, error_text, created_at, updated_at)
     VALUES ('msg1', 'conv1', 1, 'user', 'complete', 'hello', NULL, NULL, NULL,
             '${TIMESTAMP}', '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'attachment',
    `INSERT INTO attachment (id, kind, mime_type, byte_size, storage_name, width, height, sha256, created_at)
     VALUES ('a-old', 'file', 'text/plain', 3, 'old.txt', NULL, NULL, '${'a'.repeat(64)}', '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'attachment',
    `INSERT INTO attachment (id, kind, mime_type, byte_size, storage_name, width, height, sha256, created_at)
     VALUES ('a-used', 'file', 'text/plain', 3, 'used.txt', NULL, NULL, '${'b'.repeat(64)}', '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'message_attachment',
    "INSERT INTO message_attachment (message_id, attachment_id, position) VALUES ('msg1', 'a-used', 0)",
  )
  insertRows(
    database,
    'resume',
    `INSERT INTO resume (id, title, target_job_json, status, current_revision_id, conversation_id,
       created_at, updated_at)
     VALUES ('r1', 'Resume', NULL, 'draft', 'rev1', NULL, '${TIMESTAMP}', '${TIMESTAMP}')`,
  )
  insertRows(
    database,
    'resume_revision',
    `INSERT INTO resume_revision (id, resume_id, seq, label, origin, run_id, state_json,
       superseded_at, created_at)
     VALUES ('rev1', 'r1', 1, 'Create', 'user', NULL, '{"sections":[]}', NULL, '${TIMESTAMP}')`,
  )
}

function sortedRows(rows: readonly BackupRow[]): readonly string[] {
  return rows.map((row) => JSON.stringify(row)).sort()
}

let source: NodeSqliteDatabase
let target: NodeSqliteDatabase

beforeEach(() => {
  source = createMigratedDatabase()
  target = createMigratedDatabase()
  seedRows(source)
})

afterEach(() => {
  source.close()
  target.close()
})

describe('SqliteBackupStore', () => {
  it('dumps every table and restores the dump into a fresh schema', async () => {
    const store = new SqliteBackupStore(source)
    const tables = await store.dumpTables()
    expect(Object.keys(tables).sort()).toEqual([...BACKUP_TABLES].sort())

    const targetStore = new SqliteBackupStore(target)
    await targetStore.replaceAll(tables)

    const restored = await targetStore.dumpTables()
    for (const table of BACKUP_TABLES) {
      expect(sortedRows(restored[table] ?? []), table).toEqual(sortedRows(tables[table] ?? []))
    }
    expect(await foreignKeyViolations(target)).toEqual([])
  })

  it('applies a document in one transaction: a failing row leaves the old data', async () => {
    const store = new SqliteBackupStore(target)
    const tables = await new SqliteBackupStore(source).dumpTables()
    const broken = {
      ...tables,
      message: [
        ...(tables.message ?? []),
        {
          ...(tables.message?.[0] as BackupRow),
          id: 'msg2',
          seq: 1,
          conversation_id: 'missing-conversation',
        },
      ],
    }

    await expect(store.replaceAll(broken)).rejects.toThrow()
    const after = await store.dumpTables()
    expect(after.message ?? []).toEqual([])
  })

  it('clears every table', async () => {
    const store = new SqliteBackupStore(source)

    await store.clearAll()

    const emptied = await store.dumpTables()
    for (const table of BACKUP_TABLES) expect(emptied[table] ?? []).toEqual([])
  })

  it('finds only attachments nothing refers to', async () => {
    const store = new SqliteBackupStore(source)

    const orphans = await store.listOrphanAttachments('2026-06-01T00:00:00.000Z' as never)

    expect(orphans.map((orphan) => orphan.id)).toEqual(['a-old'])
    expect(orphans[0]?.storageName).toBe('old.txt')
  })

  it('deletes the named attachment rows', async () => {
    const store = new SqliteBackupStore(source)

    await store.deleteAttachments(['a-old'])

    expect(await store.listAttachmentStorageNames()).toEqual(['used.txt'])
  })
})
