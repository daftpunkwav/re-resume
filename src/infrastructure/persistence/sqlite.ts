/**
 * @file sqlite
 * @description Connection and query seam for the SQL plugin. The plugin only
 * exists inside the Tauri runtime, so repositories depend on the SqlDatabase
 * interface declared here rather than on the plugin itself: that indirection is
 * what lets the row mappers and the revision/trim algorithm be exercised in
 * Node without a WebView.
 *
 * Constraints:
 * - `@tauri-apps/plugin-sql` 2.6.0 exposes execute, select and close only —
 *   there is no transaction command. Transactions are therefore issued as SQL
 *   (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`). Whether the plugin keeps one
 *   transaction open across several execute calls is unverified (spec section
 *   11); if it does not, the repository composition must move to a single Rust
 *   command and this file is the only place that changes.
 * - SQLite defaults foreign keys OFF, and the schema's ON DELETE CASCADE and
 *   ON DELETE RESTRICT clauses are inert until it is on. The pragma is set
 *   explicitly on open and read back, because a pragma that silently does not
 *   apply would turn every cascade delete into an orphaned row.
 * - IMMEDIATE, not DEFERRED: saveDocument reads the chain before it writes, and
 *   a deferred transaction that upgrades from a read to a write is the classic
 *   way to hit SQLITE_BUSY.
 */

import type PluginDatabase from '@tauri-apps/plugin-sql'

export type SqlValue = string | number | null

export interface SqlQueryResult {
  readonly rowsAffected: number
}

export interface SqlDatabase {
  execute(query: string, bindValues?: readonly SqlValue[]): Promise<SqlQueryResult>
  select<T>(query: string, bindValues?: readonly SqlValue[]): Promise<readonly T[]>
  /**
   * Runs work in a write transaction. The work either completes and commits,
   * or every statement it issued is rolled back — partial application of a
   * composite write is a contract violation, not a degraded outcome.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>
}

/**
 * Connects through the SQL plugin and returns the seam above. Migrations are
 * not run here: the plugin runs the ones registered on the Rust side when it
 * loads a connection, and its bookkeeping table is not this build's to write
 * (spec section 6.2).
 */
export async function openSqliteDatabase(connectionString: string): Promise<SqlDatabase> {
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  return new PluginSqlDatabase(await Database.load(connectionString))
}

/** The only place `@tauri-apps/plugin-sql` is referenced at runtime. */
class PluginSqlDatabase implements SqlDatabase {
  readonly #connection: PluginDatabase
  #transactionDepth = 0

  constructor(connection: PluginDatabase) {
    this.#connection = connection
  }

  async execute(query: string, bindValues?: readonly SqlValue[]): Promise<SqlQueryResult> {
    return this.#connection.execute(query, bindValues === undefined ? undefined : [...bindValues])
  }

  async select<T>(query: string, bindValues?: readonly SqlValue[]): Promise<readonly T[]> {
    return this.#connection.select<T[]>(query, bindValues === undefined ? undefined : [...bindValues])
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    // SQLite has no nested transactions: a second BEGIN fails outright. Work
    // issued from inside an open transaction therefore joins that transaction,
    // which preserves all-or-nothing for the whole nest.
    if (this.#transactionDepth > 0) return work()
    await this.execute('BEGIN IMMEDIATE')
    this.#transactionDepth += 1
    try {
      const result = await work()
      await this.execute('COMMIT')
      return result
    } catch (error) {
      await this.#rollbackAfterFailure(error)
      throw error
    } finally {
      this.#transactionDepth -= 1
    }
  }

  async close(): Promise<boolean> {
    return this.#connection.close()
  }

  /**
   * Enables and then verifies foreign key enforcement. The read-back is what
   * turns "the pragma did not apply" from a silent data-integrity problem into
   * a startup failure with a message naming the setting.
   */
  async enableForeignKeys(): Promise<void> {
    await this.execute('PRAGMA foreign_keys = ON')
    const rows = await this.select<{ foreign_keys: number }>('SELECT * FROM pragma_foreign_keys')
    const setting = rows[0]?.foreign_keys
    if (setting !== 1) {
      throw new Error(
        `SQLite reports foreign_keys = ${String(setting)} after PRAGMA foreign_keys = ON. ` +
          'Every ON DELETE CASCADE and ON DELETE RESTRICT clause in the schema is inert until this is 1, ' +
          'so the repositories refuse to run.',
      )
    }
  }

  async #rollbackAfterFailure(failure: unknown): Promise<void> {
    try {
      await this.execute('ROLLBACK')
    } catch (rollbackFailure) {
      throw new Error(
        `Rolling back the failed transaction threw, so the connection may hold an open write lock: ` +
          `${describe(rollbackFailure)}. The failure that triggered it was: ${describe(failure)}`,
        { cause: rollbackFailure },
      )
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
