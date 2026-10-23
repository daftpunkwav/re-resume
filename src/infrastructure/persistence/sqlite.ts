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
 * - The plugin keeps one pool per connection string and its close command
 *   closes whichever pool is registered under that string at that moment. The
 *   application builds more than one composition root over the same database —
 *   one per settings change, and two in development, where the framework mounts
 *   the services provider twice — so the database is opened once here and
 *   shared: every holder takes a claim, and the pool is closed when the last
 *   claim is released. Closing it while another root still holds it would
 *   leave that root with a pool every statement fails on.
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
 * The database the seam opens, with the two operations the plugin-backed
 * implementation adds on top of the statements: the foreign key check the
 * startup depends on, and the release of this holder's claim.
 */
export interface ManagedSqlDatabase extends SqlDatabase {
  close(): Promise<boolean>
  enableForeignKeys(): Promise<void>
}

/**
 * The one database behind a connection string, and the claims on it.
 *
 * The connection is a promise because two holders may ask for the same
 * database at the same time: the second one has to wait for the first open
 * rather than start a second one, or the plugin would hold two pools under one
 * connection string and the second load would replace the first.
 */
interface SharedDatabase {
  readonly connectionString: string
  readonly connection: Promise<PluginSqlDatabase>
  /** How many holders still hold a claim on this database. */
  claims: number
  /**
   * Set while the pool behind it is being closed. A holder that arrives then
   * waits for the close to finish: the plugin's close command closes every
   * pool it holds, so a pool registered while this one is still closing would
   * be closed with it.
   */
  closing: Promise<void> | null
}

/** The databases this process has open, one per connection string. */
const sharedDatabases = new Map<string, SharedDatabase>()

/**
 * Connects through the SQL plugin and returns the seam above. Migrations are
 * not run here: the plugin runs the ones registered on the Rust side when it
 * loads a connection, and its bookkeeping table is not this build's to write
 * (spec section 6.2).
 */
export async function openSqliteDatabase(
  connectionString: string,
): Promise<ManagedSqlDatabase> {
  const shared = await claimDatabase(connectionString)
  const connection = await shared.connection
  return new ClaimedSqlDatabase(shared, connection)
}

/**
 * The claim on the database behind a connection string: the open one, or a
 * fresh one once the pool of a closed database is gone.
 */
async function claimDatabase(connectionString: string): Promise<SharedDatabase> {
  const existing = sharedDatabases.get(connectionString)
  if (existing !== undefined) {
    if (existing.closing !== null) {
      await existing.closing
      return claimDatabase(connectionString)
    }
    existing.claims += 1
    return existing
  }
  const shared: SharedDatabase = {
    connectionString,
    connection: openPluginDatabase(connectionString),
    claims: 1,
    closing: null,
  }
  sharedDatabases.set(connectionString, shared)
  // A database that failed to open must not stay in the registry: the next
  // caller has to be able to try again rather than inherit the failure.
  void shared.connection.catch(() => {
    if (sharedDatabases.get(connectionString) === shared) sharedDatabases.delete(connectionString)
  })
  return shared
}

/**
 * Opens the connection the plugin pools and asks the native shell to pin it to
 * a single one, so that the statements of a transaction reach the same
 * connection.
 */
async function openPluginDatabase(connectionString: string): Promise<PluginSqlDatabase> {
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

/**
 * One holder's claim on a shared database. The statements go to the shared
 * connection; the claim decides when the pool behind it is closed.
 */
class ClaimedSqlDatabase implements ManagedSqlDatabase {
  readonly #shared: SharedDatabase
  readonly #connection: PluginSqlDatabase
  #released = false

  constructor(shared: SharedDatabase, connection: PluginSqlDatabase) {
    this.#shared = shared
    this.#connection = connection
  }

  execute(query: string, bindValues?: readonly SqlValue[]): Promise<SqlQueryResult> {
    return this.#connection.execute(query, bindValues)
  }

  select<T>(query: string, bindValues?: readonly SqlValue[]): Promise<readonly T[]> {
    return this.#connection.select<T>(query, bindValues)
  }

  transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T> {
    return this.#connection.transaction(work)
  }

  enableForeignKeys(): Promise<void> {
    return this.#connection.enableForeignKeys()
  }

  /**
   * Releases this holder's claim. The pool is closed when the last claim goes,
   * and not before: the plugin closes whichever pool is registered under the
   * connection string, so closing it here would take the pool away from the
   * holders that are still using it.
   *
   * The entry keeps naming the pool while the close runs, and a holder that
   * arrives in that window waits for it. The plugin's close command closes
   * every pool it holds, so a pool that opened while this one was still
   * closing would go with it.
   */
  async close(): Promise<boolean> {
    if (this.#released) return true
    this.#released = true
    this.#shared.claims -= 1
    if (this.#shared.claims > 0) return true
    const closed = this.#connection.close()
    this.#shared.closing = closed.then(
      () => undefined,
      () => undefined,
    )
    try {
      return await closed
    } finally {
      if (sharedDatabases.get(this.#shared.connectionString) === this.#shared) {
        sharedDatabases.delete(this.#shared.connectionString)
      }
    }
  }
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
