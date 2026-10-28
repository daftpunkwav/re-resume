/**
 * @file migrations.test
 * @description What each migration file holds. The schema is applied natively,
 * so a file that lost its statements — or gained one while it is still meant to
 * be a placeholder — would only show up on a fresh install otherwise.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')
const MIGRATIONS = join(REPOSITORY_ROOT, 'src/infrastructure/persistence/migrations')

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS, name), 'utf8')
}

/** A migration body without its comments: what the plugin would actually run. */
function executableStatements(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .trim()
}

describe('migrations', () => {
  it('keeps the initial schema in place', () => {
    const initial = readMigration('001_init.sql')
    expect(initial).toContain('CREATE TABLE')
  })

  it('creates the settings and provider tables at version 2', () => {
    const settings = readMigration('002_settings.sql')
    expect(settings).toContain('CREATE TABLE app_settings')
    expect(settings).toContain('CREATE TABLE provider_config')
    expect(settings).toContain('CREATE UNIQUE INDEX idx_provider_active')
    // The single-row and single-active invariants live in the schema itself.
    expect(settings).toContain("CHECK (id = 'default')")
    expect(settings).toContain('WHERE is_active = 1')
  })

  it('creates the information library tables at version 7', () => {
    const info = readMigration('007_info.sql')
    expect(info).toContain('CREATE TABLE custom_module')
    expect(info).toContain('CREATE TABLE info_entry')
    expect(info).toContain('CREATE TABLE change_record')
    // The module owns its entries; the resume side deliberately has no FK here.
    expect(info).toContain('REFERENCES custom_module (id) ON DELETE CASCADE')
    expect(info).toContain("CHECK ((module_kind = 'custom') = (custom_module_id IS NOT NULL))")
    expect(info).toContain('CREATE UNIQUE INDEX idx_info_entry_order')
    // SQLite treats NULL values as distinct in a unique index; the module scope
    // must read a built-in module's missing module id as one value.
    expect(info).toContain("IFNULL(custom_module_id, '')")
    expect(info).toContain('CREATE INDEX idx_change_entity')
  })

  it('keeps versions 3 to 6 comment-only', () => {
    // An applied migration's body is immutable: version 3 was recorded empty, so
    // the library schema ships as version 7 and these versions stay no-ops.
    for (const name of [
      '003_info.sql',
      '004_conversation.sql',
      '005_resume.sql',
      '006_drop_legacy.sql',
    ]) {
      expect(executableStatements(readMigration(name)), `${name} must stay empty`).toBe('')
    }
  })
})
