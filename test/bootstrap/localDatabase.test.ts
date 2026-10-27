/**
 * @file localDatabase.test
 * @description The startup order: the pre-migration copy, then the connection,
 * then the foreign-key verification. A failed verification releases the claim.
 */

import { describe, expect, it, vi } from 'vitest'

import { startLocalDatabase } from '../../src/bootstrap/localDatabase'
import type { ManagedSqlDatabase } from '../../src/infrastructure/persistence/sqlite'

function fakeDatabase(order: string[], failForeignKeys = false): ManagedSqlDatabase {
  return {
    execute: vi.fn(async () => ({ rowsAffected: 0 })),
    select: vi.fn(async () => []),
    transaction: vi.fn(),
    close: vi.fn(async () => {
      order.push('close')
      return true
    }),
    enableForeignKeys: vi.fn(async () => {
      order.push('foreign-keys')
      if (failForeignKeys) throw new Error('pragma did not apply')
    }),
  } as unknown as ManagedSqlDatabase
}

describe('startLocalDatabase', () => {
  it('copies before it opens, and verifies foreign keys after', async () => {
    const order: string[] = []
    const database = fakeDatabase(order)

    await startLocalDatabase({
      backupBeforeMigration: async () => {
        order.push('backup')
      },
      openDatabase: async () => {
        order.push('open')
        return database
      },
    })

    expect(order).toEqual(['backup', 'open', 'foreign-keys'])
  })

  it('does not open the database when the copy fails', async () => {
    const openDatabase = vi.fn()

    await expect(
      startLocalDatabase({
        backupBeforeMigration: async () => {
          throw new Error('copy failed')
        },
        openDatabase,
      }),
    ).rejects.toThrow('copy failed')
    expect(openDatabase).not.toHaveBeenCalled()
  })

  it('releases the claim when the foreign-key check fails', async () => {
    const order: string[] = []
    const database = fakeDatabase(order, true)

    await expect(
      startLocalDatabase({
        backupBeforeMigration: async () => undefined,
        openDatabase: async () => database,
      }),
    ).rejects.toThrow('pragma did not apply')

    expect(order).toEqual(['foreign-keys', 'close'])
  })
})
