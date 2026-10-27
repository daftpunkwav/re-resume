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

  it('reserves versions 3 to 6 as comment-only placeholders', () => {
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
