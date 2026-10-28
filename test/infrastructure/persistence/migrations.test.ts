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

  it('creates the conversation tables at version 8', () => {
    const conversation = readMigration('008_conversation.sql')
    for (const table of [
      'conversation',
      'message',
      'message_attachment',
      'message_context',
      'attachment',
      'job_posting',
      'agent_run',
      'tool_invocation',
    ]) {
      expect(conversation).toContain(`CREATE TABLE ${table} `)
    }
    // The v1 tables this version replaces must be dropped before any CREATE:
    // their foreign keys point at agent_run with RESTRICT, so an upgrade would
    // otherwise abort on a table that already exists or a violated reference.
    const firstCreate = conversation.indexOf('CREATE TABLE')
    for (const legacy of [
      'tool_invocation',
      'variant',
      'claim',
      'document_revision',
      'job_posting',
      'agent_run',
    ]) {
      const drop = conversation.indexOf(`DROP TABLE IF EXISTS ${legacy};`)
      expect(drop, `${legacy} must be dropped`).toBeGreaterThan(-1)
      expect(drop, `${legacy} must be dropped before the first CREATE`).toBeLessThan(firstCreate)
    }
    // One run per conversation is a database invariant, not a convention.
    expect(conversation).toContain(
      "CREATE UNIQUE INDEX idx_run_one_running ON agent_run (conversation_id) WHERE status = 'running'",
    )
    // A tool card exists exactly for a tool message.
    expect(conversation).toContain("CHECK ((kind = 'tool') = (tool_json IS NOT NULL))")
  })

  it('creates the resume document tables at version 9', () => {
    const resume = readMigration('009_resume.sql')
    for (const table of ['resume', 'resume_revision', 'resume_snapshot']) {
      expect(resume).toContain(`CREATE TABLE ${table} `)
    }
    // The v1 tables this version replaces must be dropped before any CREATE:
    // version 1 created them with a different shape, and creating beside them
    // fails with "table resume already exists".
    const firstCreate = resume.indexOf('CREATE TABLE')
    for (const legacy of ['document_revision', 'resume_snapshot', 'resume']) {
      const drop = resume.indexOf(`DROP TABLE IF EXISTS ${legacy};`)
      expect(drop, `${legacy} must be dropped`).toBeGreaterThan(-1)
      expect(drop, `${legacy} must be dropped before the first CREATE`).toBeLessThan(firstCreate)
    }
    // The document state lives in the revision, and the cursor is a pointer to
    // it: a revision belongs to exactly one resume and one sequence number.
    expect(resume).toContain('state_json TEXT NOT NULL')
    expect(resume).toContain('REFERENCES resume (id) ON DELETE CASCADE')
    expect(resume).toContain('UNIQUE (resume_id, seq)')
    expect(resume).toContain('frozen_state_json TEXT NOT NULL')
    expect(resume).toContain('materialized_json TEXT NOT NULL')
    expect(resume).toContain("CHECK (status IN ('draft', 'frozen'))")
  })

  it('keeps versions 3 to 6 comment-only', () => {
    // An applied migration's body is immutable: these versions were recorded as
    // empty placeholders, so later schemas ship as new versions (7, 8 and 9)
    // and these stay no-ops.
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
