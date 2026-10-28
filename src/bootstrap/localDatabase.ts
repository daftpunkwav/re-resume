/**
 * @file localDatabase
 * @description The order in which the local database is opened, expressed once
 * so it can be tested without a native runtime.
 *
 * Responsibilities:
 * - Ask for the pre-migration backup before anything opens the database
 * - Open the connection, then verify foreign-key enforcement
 * - Release the claim if the verification fails, so a failed boot leaves no
 *   open connection behind
 *
 * Constraints:
 * - The backup runs first for the whole point of having one: the SQL plugin
 *   migrates the file when it connects, and a copy taken afterwards holds the
 *   rebuilt schema rather than the data that is being replaced.
 */

import type { ManagedSqlDatabase } from '../infrastructure/persistence/sqlite'

export interface LocalDatabaseStartup {
  /** Produces the one-time copy of the database as it stood before this build. */
  readonly backupBeforeMigration: () => Promise<void>
  readonly openDatabase: () => Promise<ManagedSqlDatabase>
}

export async function startLocalDatabase(startup: LocalDatabaseStartup): Promise<ManagedSqlDatabase> {
  await startup.backupBeforeMigration()
  const database = await startup.openDatabase()
  try {
    await database.enableForeignKeys()
    return database
  } catch (failure) {
    try {
      await database.close()
    } catch (cleanupFailure) {
      if (failure instanceof Error && failure.cause === undefined) {
        failure.cause = cleanupFailure
      }
    }
    throw failure
  }
}
