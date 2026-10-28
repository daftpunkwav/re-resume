/**
 * @file infoMigration.test
 * @description The information-library migration applied to a real database in
 * version order. It complements the file-content assertion: a file can read
 * correctly and still fail against the schema version 1 leaves behind.
 *
 * Why the ledger is simulated: the SQL plugin records each applied version and
 * never re-runs it, so idempotence is the ledger's property, not the SQL's. The
 * simulation applies a version only when it has not been recorded, and the test
 * then re-runs the whole sequence to show nothing is applied twice.
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyMigrationFile,
  openTestDatabase,
  type TestDatabase,
} from '../../support/nodeSqliteDatabase'

const scratchDatabases: TestDatabase[] = []

afterEach(() => {
  for (const database of scratchDatabases.splice(0)) database.closeAndRemove()
})

function openDatabase(): TestDatabase {
  const database = openTestDatabase()
  scratchDatabases.push(database)
  return database
}

/** Applies only the versions the ledger has not recorded, as the plugin does. */
function applyPending(
  database: TestDatabase,
  ledger: Set<number>,
  files: readonly string[],
): number[] {
  const applied: number[] = []
  for (const file of files) {
    const version = Number.parseInt(file, 10)
    if (ledger.has(version)) continue
    applyMigrationFile(database, file)
    ledger.add(version)
    applied.push(version)
  }
  return applied
}

function tables(database: TestDatabase): readonly string[] {
  return database
    .rows<{ readonly name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .map((row) => row.name)
}

function foreignKeyViolations(database: TestDatabase): unknown {
  return database.selectOne('PRAGMA foreign_key_check')
}

/** The v1 rows an existing installation can hold; version 1 created these tables. */
function insertLegacyRows(database: TestDatabase): void {
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

describe('information library migration', () => {
  it('applies versions 1 to 3 to an empty database and records them once', () => {
    const database = openDatabase()
    const ledger = new Set<number>()

    expect(applyPending(database, ledger, ['001_init.sql', '002_settings.sql', '003_info.sql'])).toEqual([
      1, 2, 3,
    ])

    const names = tables(database)
    expect(names).toEqual(expect.arrayContaining(['custom_module', 'info_entry', 'change_record']))
    expect(names).toEqual(expect.arrayContaining(['app_settings', 'provider_config']))
    expect(foreignKeyViolations(database)).toBeNull()

    // A second pass applies nothing: the ledger, not the SQL, owns idempotence.
    expect(applyPending(database, ledger, ['001_init.sql', '002_settings.sql', '003_info.sql'])).toEqual(
      [],
    )
    expect(tables(database)).toEqual(names)
  })

  it('upgrades a database that already holds the v1 schema and data', () => {
    const database = openDatabase()
    const ledger = new Set<number>()
    applyPending(database, ledger, ['001_init.sql'])
    insertLegacyRows(database)

    expect(applyPending(database, ledger, ['002_settings.sql', '003_info.sql'])).toEqual([2, 3])

    const names = tables(database)
    // The library version adds its tables without removing the v1 data that a
    // later cleanup version is responsible for.
    expect(names).toEqual(expect.arrayContaining(['experience', 'resume', 'custom_module', 'info_entry']))
    expect(foreignKeyViolations(database)).toBeNull()
    const legacyCount = database.selectOne<{ readonly count: number }>(
      'SELECT COUNT(*) AS count FROM experience',
    )
    expect(legacyCount?.count).toBe(1)
  })

  it('creates the version 3 tables with their constraints and cascade', () => {
    const database = openDatabase()
    applyPending(database, new Set<number>(), [
      '001_init.sql',
      '002_settings.sql',
      '003_info.sql',
    ])

    database.exec(`
INSERT INTO custom_module (id, name, fields_json, sort_order, created_at, updated_at)
VALUES ('module-1', '证书', '{"v":1,"data":[]}', 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO info_entry (
  id, module_kind, custom_module_id, title, fields_json, sort_order, origin,
  source_run_id, created_at, updated_at
) VALUES ('entry-1', 'custom', 'module-1', 'CET-6', '{"v":1,"data":{}}', 1, 'user',
          NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO change_record (
  id, scope, entity, entity_id, op, before_json, after_json, origin, run_id,
  conversation_id, label, undone_at, created_at
) VALUES ('change-1', 'library', 'infoEntry', 'entry-1', 'infoEntry.create', NULL,
          '{"v":1,"data":"{}"}', 'user', NULL, NULL, '新增条目', NULL,
          '2026-01-01T00:00:00.000Z');
`)

    // Module deletion cascades to the entries that name it.
    database.exec("DELETE FROM custom_module WHERE id = 'module-1'")
    const entryCount = database.selectOne<{ readonly count: number }>(
      'SELECT COUNT(*) AS count FROM info_entry',
    )
    expect(entryCount?.count).toBe(0)
    expect(foreignKeyViolations(database)).toBeNull()

    // The closed value sets and the module association are enforced by the schema.
    expect(() =>
      database.exec(`
INSERT INTO info_entry (
  id, module_kind, custom_module_id, title, fields_json, sort_order, origin,
  source_run_id, created_at, updated_at
) VALUES ('entry-2', 'custom', NULL, 'x', '{"v":1,"data":{}}', 1, 'user',
          NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`),
    ).toThrow()
    expect(() =>
      database.exec(`
INSERT INTO info_entry (
  id, module_kind, custom_module_id, title, fields_json, sort_order, origin,
  source_run_id, created_at, updated_at
) VALUES ('entry-3', 'project', NULL, 'x', '{"v":1,"data":{}}', 1, 'robot',
          NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`),
    ).toThrow()
    expect(() =>
      database.exec(`
INSERT INTO info_entry (
  id, module_kind, custom_module_id, title, fields_json, sort_order, origin,
  source_run_id, created_at, updated_at
) VALUES ('entry-4', 'project', NULL, 'x', '{"v":1,"data":{}}', 0, 'user',
          NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`),
    ).toThrow()
  })

  it('keeps the module name case-insensitively unique', () => {
    const database = openDatabase()
    applyPending(database, new Set<number>(), [
      '001_init.sql',
      '002_settings.sql',
      '003_info.sql',
    ])
    database.exec(`
INSERT INTO custom_module (id, name, fields_json, sort_order, created_at, updated_at)
VALUES ('module-1', 'Certificates', '{"v":1,"data":[]}', 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`)
    expect(() =>
      database.exec(`
INSERT INTO custom_module (id, name, fields_json, sort_order, created_at, updated_at)
VALUES ('module-2', 'certificates', '{"v":1,"data":[]}', 2,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`),
    ).toThrow()
  })

  it('cannot re-run the version 3 body without the ledger', () => {
    const database = openDatabase()
    applyPending(database, new Set<number>(), [
      '001_init.sql',
      '002_settings.sql',
      '003_info.sql',
    ])
    // This is exactly why the plugin records versions: the body is not written
    // to be re-applied, and the ledger is what guarantees a single application.
    expect(() => applyMigrationFile(database, '003_info.sql')).toThrow(/already exists/)
  })
})
