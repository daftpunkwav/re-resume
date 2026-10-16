/**
 * @file sqlite
 * @description Connection and query seam for the SQL plugin. The plugin only
 * exists inside the Tauri runtime, so repositories depend on the SqlDatabase
 * interface declared here rather than on the plugin itself: that indirection is
 * what lets the row mappers and the revision/trim algorithm be exercised in
 * Node without a WebView.
 *
 * Constraints:
 * - The plugin pools its connections and routes each execute/select call to
 *   whichever one is free, so BEGIN IMMEDIATE and COMMIT issued as separate
 *   calls are not guaranteed to reach the same connection. openSqliteDatabase
 *   therefore asks the native shell to pin the database to a single connection
 *   (src-tauri/src/connection.rs), which is also where foreign key enforcement
 *   is configured for that connection rather than issued once and forgotten.
 * - Statements are serialised through a promise chain. SQLite tolerates one
 *   writer, and without the chain a second transaction would BEGIN while the
 *   first is still open — which SQLite answers with an error, and whose outcome
 *   depends on which caller got there first. Statements issued inside an open
 *   transaction bypass the chain; that is what the transaction-scoped
 *   SqlDatabase handed to work is for.
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
   *
   * The database handed to work is scoped to this transaction: its statements go
   * straight to the connection instead of queueing behind the lock the
   * transaction itself holds.
   */
  transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T>
}

/**
 * Connects through the SQL plugin and returns the seam above. Migrations are
 * not run here: the plugin runs the ones registered on the Rust side when it
 * loads a connection, and its bookkeeping table is not this build's to write
 * (spec section 6.2).
 */
export async function openSqliteDatabase(connectionString: string): Promise<SqlDatabase> {
  const [{ default: Database }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-sql'),
    import('@tauri-apps/api/core'),
  ])
  const connection = await Database.load(connectionString)
  // Before the first query: the plugin's own pool is still in place, and this is
  // the only point at which it can be replaced.
  await invoke('pin_sqlite_connection', { db: connectionString })
  return new PluginSqlDatabase(connection)
}

/** The only place `@tauri-apps/plugin-sql` is referenced at runtime. */
class PluginSqlDatabase implements SqlDatabase {
  readonly #connection: PluginDatabase
  /** Resolves when every statement queued before the last one has settled. */
  #queue: Promise<unknown> = Promise.resolve()

  constructor(connection: PluginDatabase) {
    this.#connection = connection
  }

  execute(query: string, bindValues?: readonly SqlValue[]): Promise<SqlQueryResult> {
    return this.#queued(() => this.#connection.execute(query, spread(bindValues)))
  }

  select<T>(query: string, bindValues?: readonly SqlValue[]): Promise<readonly T[]> {
    return this.#queued(() => this.#connection.select<T[]>(query, spread(bindValues)))
  }

  async transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    return this.#queued(async () => {
      const tx = new OpenTransaction(this.#connection)
      await tx.execute('BEGIN IMMEDIATE')
      try {
        const result = await work(tx)
        await tx.execute('COMMIT')
        return result
      } catch (error) {
        await this.#rollbackAfterFailure(error)
        throw error
      }
    })
  }

  async close(): Promise<boolean> {
    return this.#connection.close()
  }

  /**
   * Enables and then verifies foreign key enforcement. The read-back is what
   * turns "the pragma did not apply" from a silent data-integrity problem into
   * a startup failure with a message naming the setting. It is a verification
   * rather than the configuration itself: the native shell enables the pragma
   * for the pinned connection when it opens it.
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

  /**
   * Runs one statement after every statement queued before it. The queue never
   * rejects, so a failed statement does not strand the ones behind it.
   */
  #queued<T>(statement: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(statement)
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #rollbackAfterFailure(failure: unknown): Promise<void> {
    try {
      await new OpenTransaction(this.#connection).execute('ROLLBACK')
    } catch (rollbackFailure) {
      throw new Error(
        `Rolling back the failed transaction threw, so the connection may hold an open write lock: ` +
          `${describe(rollbackFailure)}. The failure that triggered it was: ${describe(failure)}`,
        { cause: rollbackFailure },
      )
    }
  }
}

/**
 * The statements of one open transaction. They reach the connection directly:
 * queueing behind the lock the enclosing transaction holds would deadlock, and
 * the pinned connection serves one statement at a time in any case.
 */
class OpenTransaction implements SqlDatabase {
  readonly #connection: PluginDatabase

  constructor(connection: PluginDatabase) {
    this.#connection = connection
  }

  execute(query: string, bindValues?: readonly SqlValue[]): Promise<SqlQueryResult> {
    return this.#connection.execute(query, spread(bindValues))
  }

  select<T>(query: string, bindValues?: readonly SqlValue[]): Promise<readonly T[]> {
    return this.#connection.select<T[]>(query, spread(bindValues))
  }

  transaction<T>(): Promise<T> {
    return Promise.reject(
      new Error(
        'SQLite has no nested transaction, and the one already open covers every statement issued ' +
          'inside it: whichever of the two commits, both sets of writes land together.',
      ),
    )
  }
}

function spread(bindValues: readonly SqlValue[] | undefined): SqlValue[] | undefined {
  return bindValues === undefined ? undefined : [...bindValues]
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
