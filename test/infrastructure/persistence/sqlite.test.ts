/**
 * @file sqlite
 * @description The statement serialisation the connection seam is responsible
 * for. SQLite answers a second BEGIN issued while one is open with an error,
 * and it folds any statement that arrives mid-transaction into that
 * transaction — so both are exercised here rather than left to the runtime.
 *
 * The plugin's own behaviour is modelled rather than mocked away: it keeps one
 * pool per connection string, its close command closes whichever pool is
 * registered under that string, and a statement against a closed pool fails.
 * That is what makes the lifetime of a shared connection observable here.
 */

import { describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => {
  const pools = new Map<string, { closed: boolean; statements: string[] }>()
  return {
    pools,
    loads: 0,
    pins: 0,
    reset(): void {
      pools.clear()
      this.loads = 0
      this.pins = 0
    },
    /** The plugin's load command: one pool per connection string. */
    load(path: string) {
      plugin.loads += 1
      const pool = { closed: false, statements: [] as string[] }
      pools.set(path, pool)
      const open = (): { closed: boolean; statements: string[] } => {
        const registered = pools.get(path)
        if (registered === undefined || registered.closed) {
          throw new Error('attempted to acquire a connection from a closed pool')
        }
        return registered
      }
      return {
        execute: async (query: string) => {
          const pool = open()
          if (query === 'BEGIN IMMEDIATE' && pool.statements.at(-1)?.startsWith('OPEN') === true) {
            throw new Error('cannot start a transaction within a transaction')
          }
          pool.statements.push(query)
          return { rowsAffected: 0 }
        },
        select: async <T>(query: string) => {
          const pool = open()
          pool.statements.push(query)
          return [] as T[]
        },
        // The plugin's close command without a database name closes every pool
        // it holds, whichever handle asked for it.
        close: async () => {
          for (const pool of pools.values()) pool.closed = true
          return true
        },
      }
    },
  }
})

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async (path: string) => plugin.load(path),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string) => {
    if (command === 'pin_sqlite_connection') plugin.pins += 1
    return null
  },
}))

const { openSqliteDatabase } = await import('../../../src/infrastructure/persistence/sqlite')

/**
 * Every test opens its own connection string: the seam keeps one database per
 * connection string for the lifetime of the process, so a string shared by two
 * tests would hand the second one the database the first one opened.
 */
let connectionCounter = 0

function nextConnectionString(): string {
  connectionCounter += 1
  return `sqlite:test-${connectionCounter}.db`
}

async function openTestDatabase() {
  plugin.reset()
  const connectionString = nextConnectionString()
  const database = await openSqliteDatabase(connectionString)
  return { database, connectionString, statements: () => plugin.pools.get(connectionString)?.statements ?? [] }
}

describe('the sqlite seam', () => {
  it('runs two transactions one after the other rather than interleaving them', async () => {
    const { database, statements } = await openTestDatabase()

    await Promise.all([
      database.transaction(async (tx) => {
        await tx.execute('INSERT first')
      }),
      database.transaction(async (tx) => {
        await tx.execute('INSERT second')
      }),
    ])

    expect(statements()).toEqual([
      'BEGIN IMMEDIATE',
      'INSERT first',
      'COMMIT',
      'BEGIN IMMEDIATE',
      'INSERT second',
      'COMMIT',
    ])
  })

  it('holds a statement from outside the transaction until it has finished', async () => {
    const { database, statements } = await openTestDatabase()
    const order: string[] = []
    let openTheGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      openTheGate = resolve
    })

    const inside = database.transaction(async (tx) => {
      order.push('transaction-started')
      await tx.execute('INSERT inside')
      await gate
      order.push('transaction-finished')
    })
    const outside = database.execute('INSERT outside').then(() => {
      order.push('statement-outside')
    })

    await Promise.resolve()
    openTheGate()
    await Promise.all([inside, outside])

    // The outside statement would otherwise have landed inside the open
    // transaction and been committed or rolled back with it.
    expect(order).toEqual(['transaction-started', 'transaction-finished', 'statement-outside'])
    expect(statements()).toEqual([
      'BEGIN IMMEDIATE',
      'INSERT inside',
      'COMMIT',
      'INSERT outside',
    ])
  })

  it('refuses a transaction started inside the one already open', async () => {
    const { database } = await openTestDatabase()

    await expect(
      database.transaction(async (tx) => tx.transaction(async (nested) => nested.execute('SELECT 1'))),
    ).rejects.toThrow(/nested transaction/)
  })
})

describe('the sqlite seam over a shared database', () => {
  it('opens one connection for the roots that ask for the same database', async () => {
    plugin.reset()
    const connectionString = nextConnectionString()

    const first = await openSqliteDatabase(connectionString)
    const second = await openSqliteDatabase(connectionString)

    expect(plugin.loads).toBe(1)
    expect(plugin.pins).toBe(1)
    expect(plugin.pools.size).toBe(1)

    await first.close()
    await second.close()
  })

  it('keeps the connection open while another root still holds it', async () => {
    plugin.reset()
    const connectionString = nextConnectionString()

    const first = await openSqliteDatabase(connectionString)
    const second = await openSqliteDatabase(connectionString)

    // The root that goes away releases its claim. The connection behind it
    // belongs to the other root as well, and closing it here would leave that
    // root with a pool every statement fails on.
    await first.close()

    await expect(second.select('SELECT * FROM experience')).resolves.toEqual([])

    await second.close()
  })

  it('closes the connection once the last root has released it', async () => {
    plugin.reset()
    const connectionString = nextConnectionString()

    const first = await openSqliteDatabase(connectionString)
    const second = await openSqliteDatabase(connectionString)
    await first.close()
    await second.close()

    expect(plugin.pools.get(connectionString)?.closed).toBe(true)
  })

  it('opens a new connection for the database the last root released', async () => {
    plugin.reset()
    const connectionString = nextConnectionString()

    const first = await openSqliteDatabase(connectionString)
    await first.close()
    const second = await openSqliteDatabase(connectionString)

    expect(plugin.loads).toBe(2)
    await second.close()
  })
})
