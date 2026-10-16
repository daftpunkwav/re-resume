/**
 * @file sqlite
 * @description The statement serialisation the connection seam is responsible
 * for. SQLite answers a second BEGIN issued while one is open with an error,
 * and it folds any statement that arrives mid-transaction into that
 * transaction — so both are exercised here rather than left to the runtime.
 */

import { describe, expect, it, vi } from 'vitest'

const connection = vi.hoisted(() => ({
  statements: [] as string[],
  reset: () => {
    connection.statements.length = 0
  },
}))

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async () => ({
      execute: async (query: string) => {
        if (query === 'BEGIN IMMEDIATE' && connection.statements.at(-1)?.startsWith('OPEN') === true) {
          throw new Error('cannot start a transaction within a transaction')
        }
        connection.statements.push(query)
        return { rowsAffected: 0 }
      },
      select: async <T>(query: string) => {
        connection.statements.push(query)
        return [] as T[]
      },
      close: async () => true,
    }),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => null }))

const { openSqliteDatabase } = await import('../../../src/infrastructure/persistence/sqlite')

async function openTestDatabase() {
  connection.reset()
  return openSqliteDatabase('sqlite:test.db')
}

describe('the sqlite seam', () => {
  it('runs two transactions one after the other rather than interleaving them', async () => {
    const database = await openTestDatabase()

    await Promise.all([
      database.transaction(async (tx) => {
        await tx.execute('INSERT first')
      }),
      database.transaction(async (tx) => {
        await tx.execute('INSERT second')
      }),
    ])

    expect(connection.statements).toEqual([
      'BEGIN IMMEDIATE',
      'INSERT first',
      'COMMIT',
      'BEGIN IMMEDIATE',
      'INSERT second',
      'COMMIT',
    ])
  })

  it('holds a statement from outside the transaction until it has finished', async () => {
    const database = await openTestDatabase()
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
  })

  it('refuses a transaction started inside the one already open', async () => {
    const database = await openTestDatabase()

    await expect(
      database.transaction(async (tx) => tx.transaction(async (nested) => nested.execute('SELECT 1'))),
    ).rejects.toThrow(/nested transaction/)
  })
})
