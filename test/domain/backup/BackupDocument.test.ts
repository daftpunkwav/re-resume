/**
 * @file BackupDocument.test
 * @description The backup file contract: a document this build wrote is
 * accepted, and a file of another version, another schema or with one bad row is
 * refused as a whole instead of being partially understood.
 */

import { describe, expect, it } from 'vitest'

import {
  parseBackupDocument,
  summarizeBackupDocument,
  validateBackupTables,
} from '../../../src/domain/backup/BackupDocument'
import { backupDocument, emptyTables, tablesWithRows, TEST_TIMESTAMP } from '../../support/backupFixtures'

const APP_SETTINGS_ROW = {
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

describe('parseBackupDocument', () => {
  it('accepts a document this build wrote', () => {
    const document = backupDocument(tablesWithRows({ app_settings: [APP_SETTINGS_ROW] }))

    expect(parseBackupDocument(document)).toEqual(document)
    expect(summarizeBackupDocument(document).tables.app_settings).toBe(1)
  })

  it('refuses a document version it does not know', () => {
    const document = { ...backupDocument(), v: 2 }

    expect(() => parseBackupDocument(document)).toThrow(/version/)
  })

  it('refuses a file that is not ours', () => {
    expect(() => parseBackupDocument({ ...backupDocument(), app: 'other' })).toThrow(
      /not exported by ReResume/,
    )
  })

  it('refuses a document from another schema version', () => {
    expect(() => parseBackupDocument({ ...backupDocument(), schemaVersion: 9 })).toThrow(
      /schema version/,
    )
  })

  it('refuses a document with a missing table', () => {
    const tables = { ...emptyTables() } as Record<string, unknown>
    delete tables.attachment

    expect(() => validateBackupTables(tables as never)).toThrow(/attachment/)
  })

  it('refuses a row with an unknown column', () => {
    const tables = tablesWithRows({
      app_settings: [{ ...APP_SETTINGS_ROW, extra: 'value' }],
    })

    expect(() => validateBackupTables(tables)).toThrow(/extra/)
  })

  it('refuses a row whose enum is outside the schema', () => {
    const tables = tablesWithRows({
      resume: [
        {
          id: 'r1',
          title: 'Draft',
          target_job_json: null,
          status: 'archived',
          current_revision_id: 'rev1',
          conversation_id: null,
          created_at: TEST_TIMESTAMP,
          updated_at: TEST_TIMESTAMP,
        },
      ],
    })

    expect(() => validateBackupTables(tables)).toThrow(/status/)
  })

  it('refuses a JSON column that does not parse', () => {
    const tables = tablesWithRows({
      app_settings: [{ ...APP_SETTINGS_ROW, settings_json: '{not json' }],
    })

    expect(() => validateBackupTables(tables)).toThrow(/settings_json/)
  })

  it('refuses a settings row that is not a settings value of this build', () => {
    const tables = tablesWithRows({
      app_settings: [{ ...APP_SETTINGS_ROW, settings_json: JSON.stringify({ themeId: 'apple' }) }],
    })

    expect(() => validateBackupTables(tables)).toThrow(/settings value/)
  })

  it('requires bytes for every attachment row and a row for every byte payload', () => {
    const attachmentRow = {
      id: 'a1',
      kind: 'image',
      mime_type: 'image/png',
      byte_size: 3,
      storage_name: 'image-1.png',
      width: 1,
      height: 1,
      sha256: 'a'.repeat(64),
      created_at: TEST_TIMESTAMP,
    }
    const document = backupDocument(tablesWithRows({ attachment: [attachmentRow] }))

    expect(() => parseBackupDocument(document)).toThrow(/bytes/)
  })
})

describe('attachment payload checks', () => {
  const attachmentRow = (overrides = {}) => ({
    id: 'a1',
    kind: 'image',
    mime_type: 'image/png',
    byte_size: 4,
    storage_name: 'image-1.png',
    width: 1,
    height: 1,
    sha256: 'a'.repeat(64),
    created_at: TEST_TIMESTAMP,
    ...overrides,
  })

  it('refuses a storage name that tries to leave the attachment directory', () => {
    const tables = tablesWithRows({ attachment: [attachmentRow({ storage_name: '../escape.png' })] })

    expect(() => validateBackupTables(tables)).toThrow(/storage_name/)
  })

  it('refuses bytes whose decoded size contradicts the row', () => {
    const row = attachmentRow()
    const document = backupDocument(tablesWithRows({ attachment: [row] }), [
      { row, bytesBase64: 'AAAA' },
    ])

    expect(() => parseBackupDocument(document)).toThrow(/payload size/)
  })
})
