/**
 * @file backup
 * @description Requests the one-time native copy of the database as it stood
 * before the schema rebuild. The copy must exist before the SQL plugin loads
 * and runs the migrations, so the frontend asks for it before it opens the
 * database.
 *
 * Constraints:
 * - The command name and its answer shape are a contract with the native shell
 *   (`src-tauri/src/backup.rs`); the outcome is parsed only to be logged.
 * - The caller decides whether a failure stops the boot. This module reports
 *   the answer and lets the failure propagate.
 */

/** The native command surface, narrowed to what this module needs. */
export type NativeInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>

export interface DatabaseBackupOutcome {
  readonly status: 'created' | 'exists' | 'missing-source'
  /** Human-readable detail for the startup log; never shown in the interface. */
  readonly detail: string
}

/** The single native command that produces the copy. */
const BACKUP_COMMAND = 'backup_database_once'

export async function backupDatabaseBeforeMigration(
  invoke: NativeInvoke,
): Promise<DatabaseBackupOutcome> {
  const answer = await invoke(BACKUP_COMMAND)
  if (typeof answer !== 'string') {
    throw new Error(
      `The ${BACKUP_COMMAND} command answered with ${typeof answer} instead of the outcome string.`,
    )
  }
  if (answer.startsWith('created:')) {
    return { status: 'created', detail: answer.slice('created:'.length).trim() }
  }
  if (answer.startsWith('exists:')) {
    return { status: 'exists', detail: answer.slice('exists:'.length).trim() }
  }
  if (answer === 'no-source') {
    return { status: 'missing-source', detail: 'no database file to copy yet' }
  }
  throw new Error(
    `The ${BACKUP_COMMAND} command answered "${answer}", which is not an outcome this build understands.`,
  )
}
