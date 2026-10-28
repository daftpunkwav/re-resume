/**
 * @file nodeSqliteDatabase
 * @description A test-only `SqlDatabase` over Node's built-in SQLite. It exists so
 * the repository contract tests run the real SQL against a real SQLite engine and
 * a real file, the way the native plugin does, without starting the container.
 *
 * Constraints:
 * - Test support only: `node:sqlite` must never be imported by production code,
 *   because the window runtime has no Node built-ins.
 * - The plugin's `$1…$n` placeholders are translated to positional `?` binding;
 *   a repeated placeholder therefore still binds its value in every position.
 * - Statements are executed synchronously under the async interface: a test does
 *   not need concurrency, only the same call shape as production.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import type {
  SqlDatabase,
  SqlQueryResult,
  SqlValue,
} from '../../src/infrastructure/persistence/sqlite'

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')

/** Directory the migration files live in. */
export const MIGRATIONS_DIRECTORY = join(REPOSITORY_ROOT, 'src/infrastructure/persistence/migrations')

/** A scratch database with the helpers a migration and repository test needs. */
export interface TestDatabase extends SqlDatabase {
  /** Runs one or more raw statements, for schema setup and assertions. */
  exec(sql: string): void
  /** Runs a query that returns one row, or null. */
  selectOne<T>(sql: string, bindValues?: readonly SqlValue[]): T | null
  /** Runs a query and returns every row, synchronously, for schema assertions. */
  rows<T>(sql: string, bindValues?: readonly SqlValue[]): readonly T[]
  /** Closes the connection and deletes the scratch directory. */
  closeAndRemove(): void
}

class NodeSqliteTestDatabase implements TestDatabase {
  readonly #database: DatabaseSync
  readonly #directory: string

  constructor(database: DatabaseSync, directory: string) {
    this.#database = database
    this.#directory = directory
  }

  exec(sql: string): void {
    this.#database.exec(sql)
  }

  async execute(query: string, bindValues: readonly SqlValue[] = []): Promise<SqlQueryResult> {
    const translated = translatePlaceholders(query, bindValues)
    const statement = this.#database.prepare(translated.sql)
    const result = statement.run(...translated.values)
    return { rowsAffected: Number(result.changes) }
  }

  async select<T>(query: string, bindValues: readonly SqlValue[] = []): Promise<readonly T[]> {
    const translated = translatePlaceholders(query, bindValues)
    const statement = this.#database.prepare(translated.sql)
    return statement.all(...translated.values) as unknown as readonly T[]
  }

  selectOne<T>(sql: string, bindValues: readonly SqlValue[] = []): T | null {
    const translated = translatePlaceholders(sql, bindValues)
    const statement = this.#database.prepare(translated.sql)
    return (statement.get(...translated.values) as T | undefined) ?? null
  }

  rows<T>(sql: string, bindValues: readonly SqlValue[] = []): readonly T[] {
    const translated = translatePlaceholders(sql, bindValues)
    const statement = this.#database.prepare(translated.sql)
    return statement.all(...translated.values) as unknown as readonly T[]
  }

  async transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const result = await work(this)
      this.#database.exec('COMMIT')
      return result
    } catch (failure) {
      try {
        this.#database.exec('ROLLBACK')
      } catch (rollbackFailure) {
        throw new Error(
          `Rolling back the test transaction failed: ${String(rollbackFailure)}. ` +
            `The failure that triggered it was: ${String(failure)}`,
          { cause: rollbackFailure },
        )
      }
      throw failure
    }
  }

  closeAndRemove(): void {
    this.#database.close()
    rmSync(this.#directory, { recursive: true, force: true })
  }
}

/**
 * Rewrites the contract's `$1…$n` placeholders to SQLite's numbered `?n` form,
 * so a statement may name its parameters in any textual order and a repeated
 * placeholder binds the one value. SQLite binds numbered parameters by their
 * number, which is exactly the contract's meaning.
 */
function translatePlaceholders(
  query: string,
  bindValues: readonly SqlValue[] = [],
): { readonly sql: string; readonly values: readonly SqlValue[] } {
  let highestIndex = 0
  const sql = query.replace(/\$(\d+)/gu, (_match, digits: string) => {
    const index = Number.parseInt(digits, 10)
    if (index < 1 || index > bindValues.length) {
      throw new Error(
        `The statement names $${digits} but only ${bindValues.length.toString()} values were given.`,
      )
    }
    highestIndex = Math.max(highestIndex, index)
    return `?${index.toString()}`
  })
  return { sql, values: bindValues.slice(0, highestIndex) }
}

/** Opens a scratch file database with foreign keys enforced, as the plugin does. */
export function openTestDatabase(): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), 're-resume-info-'))
  const database = new DatabaseSync(join(directory, 're-resume.db'))
  database.exec('PRAGMA foreign_keys = ON')
  return new NodeSqliteTestDatabase(database, directory)
}

/** Executes one migration file against the database. */
export function applyMigrationFile(database: TestDatabase, fileName: string): void {
  database.exec(readFileSync(join(MIGRATIONS_DIRECTORY, fileName), 'utf8'))
}

/** Applies the information library migration to an empty database. */
export function applyInfoSchema(database: TestDatabase): void {
  // The schema lives at version 7: version 3 was recorded empty before this
  // feature existed, and an applied migration body is immutable.
  applyMigrationFile(database, '007_info.sql')
}
