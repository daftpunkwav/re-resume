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
 * The version map is forward-only. Versions 3 to 6 were registered while their
 * files were empty placeholders; their bodies stay byte-identical, and later
 * schemas ship as new versions: the information library at 7, the conversation
 * runtime at 8 and the resume document at 9. Version 10 removes the v1 tables
 * those rebuilds left behind.
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
  '007_info.sql',
  '008_conversation.sql',
  '009_resume.sql',
  '010_drop_legacy.sql',
] as const

/**
 * Tables version 8 replaces with v2 shapes. Their v1 rows do not survive: the
 * pre-migration database copy is what keeps the v1 data.
 */
const RECREATED_RUN_TABLES = ['job_posting', 'agent_run', 'tool_invocation'] as const

/** v1-only tables version 8 removes outright. */
const REMOVED_V1_TABLES = ['variant', 'claim', 'document_revision'] as const

/** Tables version 9 recreates with the resume composition shape. */
const RESUME_TABLES = ['resume', 'resume_revision', 'resume_snapshot'] as const

/**
 * v1-only tables version 10 removes. `claim` and `variant` are already gone
 * after version 8; version 10 still drops them defensively.
 */
const LEGACY_ONLY_TABLES = ['claim', 'variant', 'experience', 'profile'] as const

/**
 * Every v2 table. Version 10 must leave each one present and queryable: a DROP
 * that names a v2 table would otherwise surface only at runtime.
 */
const V2_TABLES = [
  'app_settings',
  'provider_config',
  'custom_module',
  'info_entry',
  'change_record',
  'conversation',
  'message',
  'message_attachment',
  'message_context',
  'attachment',
  'job_posting',
  'agent_run',
  'tool_invocation',
  'resume',
  'resume_revision',
  'resume_snapshot',
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

function tableNames(database: DatabaseSync): string[] {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  return rows.map((row) => row.name)
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

INSERT INTO resume_snapshot (
  id, resume_id, seq, materialized_json, created_at
) VALUES (
  'legacy-snapshot', 'legacy-resume', 1, '{"v":1,"data":{}}',
  '2024-02-01T00:00:00.000Z'
);

INSERT INTO provider_config (
  id, provider_id, model_id, base_url, secret_ref, is_active, updated_at
) VALUES (
  'legacy-provider', 'openai', 'gpt-4o-mini', NULL,
  'provider:legacy-provider', 0, '2024-02-01T00:00:00.000Z'
);
`)

  // The v1 run/provenance chain the conversation schema replaces: a posting,
  // the run that parsed it, the variant and claim rows that referenced the run
  // with RESTRICT, and the invocation the v1 approval path wrote.
  database.exec(`
INSERT INTO job_posting (
  id, raw_text, source, parsed_json, parsed_by_run_id, parsed_at, created_at
) VALUES (
  'legacy-posting', 'Legacy job description', 'paste', NULL, NULL,
  NULL, '2024-02-01T00:00:00.000Z'
);

INSERT INTO agent_run (
  id, resume_id, job_posting_id, status, error_text, started_at, ended_at
) VALUES (
  'legacy-run', 'legacy-resume', 'legacy-posting', 'completed', NULL,
  '2024-02-01T00:00:00.000Z', '2024-02-01T00:00:01.000Z'
);

UPDATE job_posting SET parsed_by_run_id = 'legacy-run' WHERE id = 'legacy-posting';

INSERT INTO variant (
  id, experience_id, label, content, emphasis, drafted_by_run_id,
  confirmed_at, created_at, updated_at
) VALUES (
  'legacy-variant', 'legacy-experience', 'Draft', 'Drafted copy', NULL,
  'legacy-run', NULL, '2024-02-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z'
);

INSERT INTO claim (
  id, experience_id, kind, statement, source_field, status, created_at, updated_at
) VALUES (
  'legacy-claim', 'legacy-experience', 'responsibility', 'Did the work', NULL,
  'pending', '2024-02-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z'
);

INSERT INTO tool_invocation (
  id, run_id, tool_name, risk, args_json, result_json, approval_state, created_at
) VALUES (
  'legacy-invocation', 'legacy-run', 'searchExperiences', 'read',
  '{"v":1,"data":"{}"}', NULL, 'executed', '2024-02-01T00:00:00.000Z'
);
`)
}

/**
 * One row in every v2 table, so version 10 can be shown to remove only the v1
 * names. The set covers both the tables rebuilt from v1 same-name tables
 * (provider configuration, postings, runs, invocations, resumes) and the tables
 * the rebuild added.
 */
function insertV2Rows(database: DatabaseSync): void {
  database.exec(`
INSERT INTO app_settings (id, settings_json, updated_at)
VALUES ('default', '{"v":1,"data":{}}', '2026-01-01T00:00:00.000Z');

INSERT INTO provider_config (
  id, name, kind, base_url, model_id, secret_ref, supports_images,
  is_active, created_at, updated_at
) VALUES (
  'provider-1', 'Main', 'openai-compatible', 'https://api.example.com/v1',
  'model-1', 'provider:provider-1', NULL, 1,
  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO custom_module (id, name, fields_json, sort_order, created_at, updated_at)
VALUES (
  'module-1', 'Side project', '{"v":1,"data":[]}', 1,
  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO info_entry (
  id, module_kind, custom_module_id, title, fields_json, sort_order,
  origin, source_run_id, created_at, updated_at
) VALUES (
  'entry-1', 'custom', 'module-1', 'Side project', '{"v":1,"data":{}}', 1,
  'user', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO change_record (
  id, scope, entity, entity_id, op, before_json, after_json, origin, label,
  undone_at, created_at
) VALUES (
  'change-1', 'library', 'infoEntry', 'entry-1', 'create', NULL,
  '{"v":1,"data":{}}', 'user', 'Created entry', NULL,
  '2026-01-01T00:00:00.000Z'
);

INSERT INTO conversation (id, title, pinned, created_at, updated_at)
VALUES (
  'conversation-1', '新对话', 0,
  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO attachment (
  id, kind, mime_type, byte_size, storage_name, sha256, created_at
) VALUES (
  'attachment-1', 'image', 'image/png', 4, 'attachment-1.png',
  '${'a'.repeat(64)}', '2026-01-01T00:00:00.000Z'
);

INSERT INTO message (
  id, conversation_id, seq, kind, status, markdown, created_at, updated_at
) VALUES (
  'message-1', 'conversation-1', 1, 'user', 'complete', '',
  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO message_attachment (message_id, attachment_id, position)
VALUES ('message-1', 'attachment-1', 0);

INSERT INTO message_context (message_id, kind, ref_id, position)
VALUES ('message-1', 'entry', 'entry-1', 0);

INSERT INTO job_posting (id, raw_text, created_at)
VALUES ('posting-1', 'Legacy job description', '2026-01-01T00:00:00.000Z');

INSERT INTO agent_run (id, conversation_id, status, started_at)
VALUES ('run-1', 'conversation-1', 'completed', '2026-01-01T00:00:00.000Z');

INSERT INTO tool_invocation (
  id, run_id, tool_name, risk, args_json, status, created_at
) VALUES (
  'invocation-1', 'run-1', 'searchInfoEntries', 'read',
  '{"v":1,"data":{}}', 'ok', '2026-01-01T00:00:00.000Z'
);

INSERT INTO resume (id, title, status, current_revision_id, created_at, updated_at)
VALUES (
  'resume-1', 'Resume', 'draft', 'revision-1',
  '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
);

INSERT INTO resume_revision (
  id, resume_id, seq, label, origin, state_json, created_at
) VALUES (
  'revision-1', 'resume-1', 1, 'Initial', 'user', '{"v":1,"data":{}}',
  '2026-01-01T00:00:00.000Z'
);

INSERT INTO resume_snapshot (
  id, resume_id, seq, frozen_state_json, materialized_json, created_at
) VALUES (
  'snapshot-1', 'resume-1', 1, '{"v":1,"data":{}}', '{"v":1,"data":{}}',
  '2026-01-01T00:00:00.000Z'
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

/**
 * The information library schema added at version 7: the columns the row
 * mappers read and the empty starting state.
 */
function expectInformationLibrarySchema(database: DatabaseSync): void {
  expect(columnNames(database, 'custom_module')).toEqual([
    'id',
    'name',
    'fields_json',
    'sort_order',
    'created_at',
    'updated_at',
  ])
  expect(columnNames(database, 'info_entry')).toEqual([
    'id',
    'module_kind',
    'custom_module_id',
    'title',
    'fields_json',
    'sort_order',
    'origin',
    'source_run_id',
    'created_at',
    'updated_at',
  ])
  expect(columnNames(database, 'change_record')).toContain('before_json')
  expect(countRows(database, 'custom_module')).toBe(0)
  expect(countRows(database, 'info_entry')).toBe(0)
  expect(countRows(database, 'change_record')).toBe(0)
}

/**
 * The conversation schema added at version 8: the columns the row mappers read,
 * the message/tool-card invariant and the one-running-run index.
 */
function expectConversationSchema(database: DatabaseSync): void {
  expect(columnNames(database, 'conversation')).toEqual([
    'id',
    'title',
    'provider_id',
    'model_id',
    'pinned',
    'active_resume_id',
    'summary',
    'summary_through_seq',
    'created_at',
    'updated_at',
  ])
  expect(columnNames(database, 'message')).toEqual([
    'id',
    'conversation_id',
    'seq',
    'kind',
    'status',
    'markdown',
    'tool_json',
    'run_id',
    'error_text',
    'created_at',
    'updated_at',
  ])
  expect(columnNames(database, 'agent_run')).toEqual([
    'id',
    'conversation_id',
    'resume_id',
    'job_posting_id',
    'status',
    'error_text',
    'prompt_tokens',
    'completion_tokens',
    'started_at',
    'ended_at',
  ])
  expect(columnNames(database, 'tool_invocation')).toEqual([
    'id',
    'run_id',
    'message_id',
    'tool_name',
    'risk',
    'args_json',
    'result_summary_json',
    'change_ids_json',
    'revision_id',
    'status',
    'created_at',
  ])

  database.prepare(
    `INSERT INTO conversation (id, title, created_at, updated_at)
     VALUES ('conversation-1', '新对话', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run()
  expect(() =>
    database
      .prepare(
        `INSERT INTO message (id, conversation_id, seq, kind, status, markdown, created_at, updated_at)
         VALUES ('message-1', 'conversation-1', 1, 'user', 'complete', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(),
  ).not.toThrow()
  // Two messages cannot share a sequence number within one conversation.
  expect(() =>
    database
      .prepare(
        `INSERT INTO message (id, conversation_id, seq, kind, status, markdown, created_at, updated_at)
         VALUES ('message-2', 'conversation-1', 1, 'user', 'complete', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(),
  ).toThrow()
  // A tool card exists exactly for tool messages.
  expect(() =>
    database
      .prepare(
        `INSERT INTO message (id, conversation_id, seq, kind, status, markdown, created_at, updated_at)
         VALUES ('message-3', 'conversation-1', 2, 'tool', 'running', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(),
  ).toThrow()

  const insertRun = database.prepare(
    `INSERT INTO agent_run (id, conversation_id, status, started_at)
     VALUES (?, 'conversation-1', 'running', '2026-01-01T00:00:00.000Z')`,
  )
  insertRun.run('run-1')
  // One run per conversation: the partial unique index rejects a second one.
  expect(() => insertRun.run('run-2')).toThrow()
}

/**
 * The resume document schema added at version 9: the columns the row mappers
 * read, the empty starting state, and the cascade that keeps revisions and
 * snapshots owned by their resume.
 */
function expectResumeSchema(database: DatabaseSync): void {
  expect(columnNames(database, 'resume')).toEqual([
    'id',
    'title',
    'target_job_json',
    'status',
    'current_revision_id',
    'conversation_id',
    'created_at',
    'updated_at',
  ])
  expect(columnNames(database, 'resume_revision')).toEqual([
    'id',
    'resume_id',
    'seq',
    'label',
    'origin',
    'run_id',
    'state_json',
    'superseded_at',
    'created_at',
  ])
  expect(columnNames(database, 'resume_snapshot')).toEqual([
    'id',
    'resume_id',
    'seq',
    'frozen_state_json',
    'materialized_json',
    'created_at',
  ])
  expect(countRows(database, 'resume')).toBe(0)
  expect(countRows(database, 'resume_revision')).toBe(0)
  expect(countRows(database, 'resume_snapshot')).toBe(0)

  database
    .prepare(
      `INSERT INTO resume (id, title, status, current_revision_id, created_at, updated_at)
       VALUES ('resume-1', 'Resume', 'draft', 'revision-1',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run()
  database
    .prepare(
      `INSERT INTO resume_revision
         (id, resume_id, seq, label, origin, state_json, created_at)
       VALUES ('revision-1', 'resume-1', 1, 'Initial', 'user',
               '{"v":1,"data":{}}', '2026-01-01T00:00:00.000Z')`,
    )
    .run()
  database
    .prepare(
      `INSERT INTO resume_snapshot
         (id, resume_id, seq, frozen_state_json, materialized_json, created_at)
       VALUES ('snapshot-1', 'resume-1', 1, '{"v":1,"data":{}}',
               '{"v":1,"data":{}}', '2026-01-01T00:00:00.000Z')`,
    )
    .run()
  // A resume owns its history: deleting the row removes both children.
  database.prepare("DELETE FROM resume WHERE id = 'resume-1'").run()
  expect(countRows(database, 'resume')).toBe(0)
  expect(countRows(database, 'resume_revision')).toBe(0)
  expect(countRows(database, 'resume_snapshot')).toBe(0)
}

/** The v1-only tables version 10 removes; every one must be gone afterwards. */
function expectLegacyTablesRemoved(database: DatabaseSync): void {
  const tables = tableNames(database)
  for (const legacy of LEGACY_ONLY_TABLES) {
    expect(tables, `${legacy} must not survive version 10`).not.toContain(legacy)
  }
}

/** The v2 schema after version 10: every table still exists and answers a query. */
function expectV2TablesQueryable(database: DatabaseSync): void {
  for (const table of V2_TABLES) {
    expect(() => countRows(database, table), `${table} must survive version 10`).not.toThrow()
  }
}

describe('migrations applied in order', () => {
  it('upgrades a database that already holds the v1 schema', () => {
    const database = openScratchDatabase()

    expect(applyMigrations(database, ['001_init.sql'])).toEqual([1])
    insertLegacyRows(database)

    const applied = applyMigrations(database, MIGRATION_FILES.slice(1))

    expect(applied).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
    // The v2 provider table replaces the legacy one rather than living beside
    // it: the old row has no fields the v2 shape could carry over.
    expect(countRows(database, 'provider_config')).toBe(0)
    expectSettingsSchema(database)
    expectInformationLibrarySchema(database)
    // Version 8 replaces the v1 run/provenance chain with the v2 one. The v1
    // rows are not carried over; the pre-migration copy holds them.
    const tables = tableNames(database)
    for (const recreated of RECREATED_RUN_TABLES) {
      expect(tables, `${recreated} must be recreated by version 8`).toContain(recreated)
      expect(countRows(database, recreated), `${recreated} must not carry v1 rows`).toBe(0)
    }
    for (const removed of REMOVED_V1_TABLES) {
      expect(tables, `${removed} must not survive version 8`).not.toContain(removed)
    }
    expectConversationSchema(database)
    // Version 9 recreates the resume tables: the v1 resume, its document
    // revision and its snapshot are gone, replaced by the composition model.
    for (const resumeTable of RESUME_TABLES) {
      expect(tables, `${resumeTable} must exist after version 9`).toContain(resumeTable)
    }
    expectResumeSchema(database)
    // Version 10 removes the v1 tables the rebuild left behind, and nothing
    // else: the experience row and the profile seed go with their tables, while
    // every v2 table stays present and queryable.
    expectLegacyTablesRemoved(database)
    expectV2TablesQueryable(database)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('creates the v2 schema on a fresh database', () => {
    const database = openScratchDatabase()

    expect(applyMigrations(database, MIGRATION_FILES)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(countRows(database, 'provider_config')).toBe(0)
    expectSettingsSchema(database)
    expectInformationLibrarySchema(database)
    expectConversationSchema(database)
    expectResumeSchema(database)
    for (const removed of REMOVED_V1_TABLES) {
      expect(tableNames(database), `${removed} must not exist`).not.toContain(removed)
    }
    expectLegacyTablesRemoved(database)
    expectV2TablesQueryable(database)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('keeps the v2 rows and tolerates a repeated run of version 10', () => {
    const database = openScratchDatabase()

    applyMigrations(
      database,
      MIGRATION_FILES.filter((file) => file !== '010_drop_legacy.sql'),
    )
    insertV2Rows(database)
    const v2Counts = new Map(
      V2_TABLES.map((table) => [table, countRows(database, table)] as const),
    )

    expect(applyMigrations(database, ['010_drop_legacy.sql'])).toEqual([10])
    expectLegacyTablesRemoved(database)
    for (const [table, count] of v2Counts) {
      expect(countRows(database, table), `${table} must keep its v2 rows`).toBe(count)
    }
    // The plugin records an applied version, so it does not rerun it; if an
    // interrupted run does repeat the file, every removal is guarded by
    // IF EXISTS and the second run is a no-op.
    expect(() => applyMigrations(database, ['010_drop_legacy.sql'])).not.toThrow()
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
