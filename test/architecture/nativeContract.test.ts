/**
 * @file nativeContract.test
 * @description The constants the TypeScript side and the native shell must
 * agree on. Each pair lives in two files that nothing else ties together, so a
 * one-sided edit would otherwise surface only as a runtime failure on one
 * platform — the same blind spot `dependencyDirection.test` closes for the
 * layers, closed here for the language boundary.
 *
 * Constraints:
 * - Both sides are read as source text and matched with a narrow pattern, the
 *   way `migrations.test` reads `lib.rs`: importing the Rust file is
 *   impossible, and importing the TypeScript modules would drag the whole
 *   composition root into a unit test.
 * - A pattern that stops matching must fail loudly, so each test asserts its
 *   own extraction produced a value before comparing the two sides.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { MAX_ATTACHMENT_BYTE_SIZE, MIME_EXTENSIONS } from '../../src/domain/conversation/Attachment'

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')

function readSource(relativePath: string): string {
  return readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8')
}

describe('native shell contract', () => {
  it('opens the same database the frontend addresses', () => {
    // The shell registers its migrations under this URL and the frontend pins
    // the connection by the exact same string; `pin_sqlite_connection` matches
    // it literally. One side renamed is a database that never opens.
    const rust = readSource('src-tauri/src/lib.rs')
    const typescript = readSource('src/bootstrap/compositionRoot.ts')

    const rustUrl = /const DATABASE_URL: &str = "([^"]+)";/u.exec(rust)?.[1]
    expect(rustUrl, 'lib.rs no longer declares DATABASE_URL as a string literal').toBeTruthy()

    const tsUrl = /export const DATABASE_CONNECTION_STRING = '([^']+)'/u.exec(typescript)?.[1]
    expect(
      tsUrl,
      'compositionRoot.ts no longer declares DATABASE_CONNECTION_STRING',
    ).toBeTruthy()

    expect(tsUrl).toBe(rustUrl)
  })

  it('backs up the database file the connection opens', () => {
    // The pre-migration backup spells the file name on its own: it copies
    // <config>/<name> before the first migration has run, and the boot report
    // names the same file. A rename that only updated the two connection
    // strings would pass the first test while the backup finds no source to
    // copy.
    const rust = readSource('src-tauri/src/backup.rs')
    const typescript = readSource('src/bootstrap/compositionRoot.ts')

    const rustName = /const DATABASE_FILE_NAME: &str = "([^"]+)";/u.exec(rust)?.[1]
    expect(rustName, 'backup.rs no longer declares DATABASE_FILE_NAME').toBeTruthy()

    const tsName = /const DATABASE_FILE_NAME = '([^']+)'/u.exec(typescript)?.[1]
    expect(tsName, 'compositionRoot.ts no longer declares DATABASE_FILE_NAME').toBeTruthy()

    const tsUrl = /export const DATABASE_CONNECTION_STRING = '([^']+)'/u.exec(typescript)?.[1]
    expect(
      tsUrl,
      'compositionRoot.ts no longer declares DATABASE_CONNECTION_STRING',
    ).toBeTruthy()

    expect(tsName).toBe(rustName)
    expect(tsUrl).toBe(`sqlite:${rustName}`)
  })

  it('accepts the same attachment extensions on both sides of the IPC', () => {
    // The Rust store refuses a storage name outside its list before the bytes
    // are written; the domain derives the same names from the MIME types it
    // accepts. A one-sided addition would upload a file the shell then refuses.
    const rust = readSource('src-tauri/src/attachments.rs')
    const list = /const ALLOWED_EXTENSIONS: \[&str; \d+\] = \[([^\]]+)\];/u.exec(rust)?.[1]
    expect(list, 'attachments.rs no longer declares ALLOWED_EXTENSIONS').toBeTruthy()

    const rustExtensions = (list as string)
      .split(',')
      .map((entry) => entry.trim().replaceAll('"', ''))
      // rustfmt wraps a long list across lines and leaves a trailing comma;
      // the empty artifact it produces is not an extension.
      .filter((entry) => entry.length > 0)
      .sort()

    expect(Object.values(MIME_EXTENSIONS).sort()).toEqual(rustExtensions)
  })

  it('enforces the same attachment size ceiling on both sides', () => {
    // The domain refuses an oversized attachment before the IPC call; the
    // command repeats the check so a caller on the boundary cannot fill the
    // disk. The Rust side may write the bound as a product, so both sides are
    // evaluated before they are compared.
    const rust = readSource('src-tauri/src/attachments.rs')
    const expression = /const MAX_ATTACHMENT_BYTE_SIZE: usize = ([^;]+);/u.exec(rust)?.[1]
    expect(expression, 'attachments.rs no longer declares MAX_ATTACHMENT_BYTE_SIZE').toBeTruthy()

    const rustBound = (expression as string)
      .split('*')
      .map((factor) => Number.parseInt(factor.trim(), 10))
      .reduce((left, right) => left * right)
    expect(Number.isFinite(rustBound), 'the Rust bound is not a product of integers').toBe(true)

    expect(MAX_ATTACHMENT_BYTE_SIZE).toBe(rustBound)
  })
})
