/**
 * @file reservedMigrations.test
 * @description Byte-level guard for the migration versions that databases
 * recorded while their files held only a comment.
 *
 * Why this exists: the SQL plugin records a checksum for every applied
 * migration and refuses to open a database whose recorded checksum no longer
 * matches the file. Versions 3 to 6 were registered and recorded as
 * comment-only files, so even a comment change in one of them makes an existing
 * database fail to boot with "migration N was previously applied but has been
 * modified". The hashes below are the exact bodies those databases recorded; a
 * deliberate change here needs a new migration version instead.
 *
 * Constraints:
 * - The hashes are computed over the file bytes, not over the executable
 *   statements: a comment is part of the recorded checksum.
 * - The reserved versions must also stay free of executable SQL: a database
 *   that has not recorded them yet applies whatever statements they contain.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { MIGRATIONS_DIRECTORY } from '../../support/nodeSqliteDatabase'

interface ReservedMigration {
  readonly file: string
  readonly sha256: string
}

/** The exact bodies the plugin recorded for versions 3 to 6. */
const RESERVED_MIGRATIONS: readonly ReservedMigration[] = [
  {
    file: '003_info.sql',
    sha256: '0a982256123d529517e4145f5514e73a7c6fafc7da4fb1d48de4e34a511e545c',
  },
  {
    file: '004_conversation.sql',
    sha256: 'be8ae2f171fff94df55396e4c020c18792e69e900ce165a3a1ea689659c14957',
  },
  {
    file: '005_resume.sql',
    sha256: '808f904f6a2dbc984cb3ee452e0a84ade5859fee4587aff0441f212a0ee7c038',
  },
  {
    file: '006_drop_legacy.sql',
    sha256: '6194e47221a8dfb014d28fa7d25fa4ca0e7acfe834d53957fbc20cab9693385e',
  },
]

function readMigrationBytes(fileName: string): Buffer {
  return readFileSync(join(MIGRATIONS_DIRECTORY, fileName))
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The lines the plugin would actually execute. */
function executableStatements(bytes: Buffer): string {
  return bytes
    .toString('utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .trim()
}

describe('reserved migrations', () => {
  it('keeps the applied bodies byte-identical to what databases recorded', () => {
    for (const migration of RESERVED_MIGRATIONS) {
      expect(
        sha256(readMigrationBytes(migration.file)),
        `${migration.file} changed after it was applied; an applied migration body is immutable`,
      ).toBe(migration.sha256)
    }
  })

  it('keeps the reserved versions free of executable SQL', () => {
    for (const migration of RESERVED_MIGRATIONS) {
      expect(
        executableStatements(readMigrationBytes(migration.file)),
        `${migration.file} must stay comment-only`,
      ).toBe('')
    }
  })

  it('keeps the information library schema in the appended version', () => {
    // The guard above pins the reserved bodies; this one keeps the actual schema
    // from being removed together with the explanation that used to live there.
    expect(readMigrationBytes('007_info.sql').toString('utf8')).toContain(
      'CREATE TABLE info_entry',
    )
  })
})
