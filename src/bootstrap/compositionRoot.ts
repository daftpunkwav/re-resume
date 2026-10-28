/**
 * @file compositionRoot
 * @description The one module allowed to construct infrastructure and hand it
 * to the interface as ready-to-call services. Everything below
 * `presentation/` receives that surface and never sees a repository, a SQL
 * string or a provider.
 *
 * Responsibilities:
 * - Run the startup sequence in order: backup, open the database, verify it
 * - Construct the port implementations and wire the settings use cases to them
 * - Report the build facts the about section shows
 * - Release the claim on the shared database on shutdown
 *
 * Constraints:
 * - This module must not import from `presentation/`: the dependency points
 *   one way, and the interface receives this contract rather than the reverse.
 * - No business rule lives here. A rule stated in a use case stays there; this
 *   file only decides which implementation each port receives.
 */

import type { Clock } from '../domain/shared/Clock'
import type { CompositionRoot } from './capabilities'
import { describeAppInfo } from './buildInfo'
import { createAppSettingsService } from './wiring/appSettings'
import { createInfoService } from './wiring/info'
import { startLocalDatabase } from './localDatabase'
import { backupDatabaseBeforeMigration } from '../infrastructure/persistence/backup'
import { openSqliteDatabase } from '../infrastructure/persistence/sqlite'
import { SqliteAppSettingsRepository } from '../infrastructure/persistence/settings/SqliteAppSettingsRepository'
import { SqliteCustomModuleRepository } from '../infrastructure/persistence/info/SqliteCustomModuleRepository'
import { SqliteInfoEntryRepository } from '../infrastructure/persistence/info/SqliteInfoEntryRepository'
import { NoResumeEntryReferences } from '../infrastructure/persistence/info/NoResumeEntryReferences'
import { StrongholdSecretStore } from '../infrastructure/security/StrongholdSecretStore'
import type { StrongholdSecretStoreOptions } from '../infrastructure/security/StrongholdSecretStore'
import { SystemClock } from '../infrastructure/platform/systemClock'
import { RandomIdGenerator } from '../infrastructure/platform/randomIdGenerator'

/**
 * Connection string of the application database. Must match the one the native
 * shell registers its migrations under; a different spelling opens a second,
 * empty database.
 */
export const DATABASE_CONNECTION_STRING = 'sqlite:re-resume.db'

/** The database file name inside the application config directory. */
const DATABASE_FILE_NAME = 're-resume.db'

export interface CompositionRootOptions {
  /** Connection string handed to the SQL plugin verbatim. */
  readonly databaseConnectionString: string
  /**
   * Stronghold snapshot path and unlock password; the password is never
   * persisted. Provider configuration is what opens the snapshot, and the
   * provider settings are not part of the services this root exposes yet.
   */
  readonly stronghold: StrongholdSecretStoreOptions
}

/**
 * Copies the database before the SQL plugin has a chance to migrate it. A
 * failure is reported to the startup log and does not stop the boot: the copy
 * is a safety net, and refusing to start because it could not be made would
 * cost the user the application over a precaution.
 */
async function recordPreMigrationBackup(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    const outcome = await backupDatabaseBeforeMigration(invoke)
    // An operational record, not trace output: the answer says whether a copy
    // of the pre-rebuild database was made.
    console.info(`[startup] database backup: ${outcome.status} (${outcome.detail})`)
  } catch (failure) {
    console.warn(
      '[startup] the pre-migration database backup could not be made; continuing without it.',
      failure,
    )
  }
}

/**
 * Absolute location of the database file, or null when it cannot be resolved.
 * The directory is the one the SQL plugin resolves a relative `sqlite:` URL
 * against (the application config directory), so this path is the same file the
 * plugin opens.
 */
async function resolveDatabaseFile(): Promise<string | null> {
  try {
    const { appConfigDir, join } = await import('@tauri-apps/api/path')
    return await join(await appConfigDir(), DATABASE_FILE_NAME)
  } catch {
    // A window that cannot name its config directory still runs: the database is
    // opened through the plugin, which resolves the directory itself.
    return null
  }
}

export async function createCompositionRoot(
  options: CompositionRootOptions,
): Promise<CompositionRoot> {
  const clock: Clock = new SystemClock()
  const database = await startLocalDatabase({
    backupBeforeMigration: recordPreMigrationBackup,
    openDatabase: () => openSqliteDatabase(options.databaseConnectionString),
  })

  try {
    const settingsRepository = new SqliteAppSettingsRepository(database, clock)
    const customModuleRepository = new SqliteCustomModuleRepository(database)
    const infoEntries = new SqliteInfoEntryRepository(database, customModuleRepository)
    const ids = new RandomIdGenerator()
    const databaseFile = await resolveDatabaseFile()
    return {
      appInfo: describeAppInfo({ runtime: 'tauri', databaseFile }),
      settings: createAppSettingsService({ repository: settingsRepository }),
      info: createInfoService({
        entries: infoEntries,
        customModules: customModuleRepository,
        references: new NoResumeEntryReferences(),
        clock,
        ids,
      }),
      secrets: new StrongholdSecretStore(options.stronghold),
      shutdown: async (): Promise<void> => {
        await database.close()
      },
    }
  } catch (failure) {
    // The root never reached the caller, so no one else can release the claim.
    await database.close()
    throw failure
  }
}
