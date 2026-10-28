/**
 * @file migrationApply.test
 * @description The migration files applied to a real database in version order,
 * the way the native plugin applies them when the database is opened.
 *
 * Why this exists: the files are also read statement by statement, but a file
 * can be syntactically right and still fail against the schema the previous
 * version left behind. The v1 schema already owns a `provider_config` table of
 * a different shape, so version 2 has to replace it rather than create it, and
 * only applying the files in order shows that. Nothing here simulates the
 * plugin: the files are the input and SQLite is the judge.
 *
 * Constraints:
 * - Each test opens a temporary file, because the plugin migrates a file on
 *   disk and the assertion has to hold for that file, not for a memory
 *   database that cannot outlive the test.
 * - Versions are applied in the order `lib.rs` registers them. A later version
 *   is never applied before an earlier one, since the schema builds on it.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')
const MIGRATIONS = join(REPOSITORY_ROOT, 'src/infrastructure/persistence/migrations')

/** Every migration file, in the version order the plugin applies them. */
const MIGRATION_FILES = [
  '001_init.sql',
  '002_settings.sql',
  '003_info.sql',
  '004_conversation.sql',
  '005_resume.sql',
  '006_drop_legacy.sql',
] as const

const scratchDirectories: string[] = []
const openDatabases: DatabaseSync[] = []

function openScratchDatabase(): DatabaseSync {
  const directory = mkdtempSync(join(tmpdir(), 're-resume-migrations-'))
  scratchDirectories.push(directory)
  const database = new DatabaseSync(join(directory, 're-resume.db'))
  openDatabases.push(database)
  return database
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close()
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

/**
 * Runs the given files, one after another, and returns the versions that
 * completed. A failure is left to surface: the version that broke is the one
 * whose migration never returned.
 */
function applyMigrations(database: DatabaseSync, files: readonly string[]): number[] {
  return files.map((file) => {
    database.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
    return Number.parseInt(file, 10)
  })
}

function countRows(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}

function columnNames(database: DatabaseSync, table: string): string[] {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return columns.map((column) => column.name)
}

/**
 * Rows the v1 application could have written, using the v1 columns: an
 * experience, a resume document with its revision, and the legacy provider row
 * the v2 table replaces. v1 kept provider configuration in localStorage rather
 * than in this table, so the row has no v2 counterpart to keep.
 */
function insertLegacyRows(database: DatabaseSync): void {
  database.exec(`
INSERT INTO experience (
  id, kind, title, organization, start_date, end_date, is_current,
  detail_json, fact_version, created_at, updated_at
) VALUES (
  'legacy-experience', 'internship', 'Backend intern', 'Legacy Co',
  '2024-02-01', '2024-08-01', 0, '{"v":1,"data":{}}', 1,
  '2024-02-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z'
);

INSERT INTO resume (
  id, title, target_role, status, current_revision_id, created_at, updated_at
) VALUES (
  'legacy-resume', 'Legacy resume', 'Backend engineer', 'draft',
  'legacy-revision', '2024-02-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z'
);

INSERT INTO document_revision (
  id, resume_id, seq, label, origin, run_id, blocks_json, page_setup_json,
  superseded_at, created_at
) VALUES (
  'legacy-revision', 'legacy-resume', 1, 'Initial', 'user', NULL,
  '{"v":1,"data":[]}', '{"v":1,"data":{}}', NULL, '2024-02-01T00:00:00.000Z'
);

INSERT INTO provider_config (
  id, provider_id, model_id, base_url, secret_ref, is_active, updated_at
) VALUES (
  'legacy-provider', 'openai', 'gpt-4o-mini', NULL,
  'provider:legacy-provider', 0, '2024-02-01T00:00:00.000Z'
);
`)
}

/**
 * The v2 settings schema, checked where it matters: the columns the row mappers
 * read, and the two invariants the schema enforces instead of the use cases.
 */
function expectSettingsSchema(database: DatabaseSync): void {
  expect(columnNames(database, 'app_settings')).toEqual(['id', 'settings_json', 'updated_at'])
  expect(columnNames(database, 'provider_config')).toEqual([
    'id',
    'name',
    'kind',
    'base_url',
    'model_id',
    'secret_ref',
    'supports_images',
    'is_active',
    'created_at',
    'updated_at',
  ])

  const insertSettings = database.prepare(
    `INSERT INTO app_settings (id, settings_json, updated_at) VALUES (?, ?, ?)`,
  )
  insertSettings.run('default', '{"v":1,"data":{}}', '2026-01-01T00:00:00.000Z')
  expect(countRows(database, 'app_settings')).toBe(1)
  // One row, pinned to 'default': a second row would be a second truth.
  expect(() => insertSettings.run('other', '{"v":1,"data":{}}', '2026-01-01T00:00:00.000Z')).toThrow()

  const insertProvider = database.prepare(`
INSERT INTO provider_config (
  id, name, kind, base_url, model_id, secret_ref, supports_images,
  is_active, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  insertProvider.run(
    'provider-1',
    'Main',
    'openai-compatible',
    'https://api.example.com/v1',
    'model-1',
    'provider:provider-1',
    null,
    1,
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
  )
  // At most one active provider: the partial unique index must survive the
  // rebuild, because it is what the repository's activation path relies on.
  expect(() =>
    insertProvider.run(
      'provider-2',
      'Second',
      'anthropic',
      'https://api.anthropic.com',
      'model-2',
      'provider:provider-2',
      1,
      1,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ),
  ).toThrow()
}

describe('migrations applied in order', () => {
  it('upgrades a database that already holds the v1 schema', () => {
    const database = openScratchDatabase()

    expect(applyMigrations(database, ['001_init.sql'])).toEqual([1])
    insertLegacyRows(database)

    const applied = applyMigrations(database, MIGRATION_FILES.slice(1))

    expect(applied).toEqual([2, 3, 4, 5, 6])
    // The v2 provider table replaces the legacy one rather than living beside
    // it: the old row has no fields the v2 shape could carry over.
    expect(countRows(database, 'provider_config')).toBe(0)
    expectSettingsSchema(database)
    // Replacing one table must not take the rest of the v1 data with it; the
    // removal of the legacy tables is version 6's work, not version 2's.
    expect(countRows(database, 'experience')).toBe(1)
    expect(countRows(database, 'resume')).toBe(1)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('creates the v2 schema on a fresh database', () => {
    const database = openScratchDatabase()

    expect(applyMigrations(database, MIGRATION_FILES)).toEqual([1, 2, 3, 4, 5, 6])
    expect(countRows(database, 'provider_config')).toBe(0)
    expectSettingsSchema(database)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
