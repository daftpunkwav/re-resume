/**
 * @file backup
 * @description Requests the one-time native copy of the database as it stood
 * before the schema rebuild. The copy must exist before the SQL plugin loads
 * and runs the migrations, so the frontend asks for it before it opens the
 * database.
 *
 * Constraints:
 * - The command name and its answer shape are a contract with the native shell
 *   (`src-tauri/src/backup.rs`): one object with the outcome status and, for
 *   the outcomes that leave a file behind, the absolute path of the copy. The
 *   answer is checked field by field before it is trusted.
 * - The caller decides whether a failure stops the boot. This module reports
 *   the answer and lets the failure propagate.
 */

/** The native command surface, narrowed to what this module needs. */
export type NativeInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>

/** What the one-time copy did. */
export type DatabaseBackupStatus = 'created' | 'exists' | 'missing-source'

export interface DatabaseBackupOutcome {
  readonly status: DatabaseBackupStatus
  /**
   * Absolute path of the preserved copy. Null exactly when the status is
   * `missing-source`: there was no database file to copy.
   */
  readonly path: string | null
}

/** The single native command that produces the copy. */
const BACKUP_COMMAND = 'backup_database_once'

const BACKUP_STATUSES: readonly DatabaseBackupStatus[] = [
  'created',
  'exists',
  'missing-source',
]

function isBackupStatus(value: unknown): value is DatabaseBackupStatus {
  return typeof value === 'string' && (BACKUP_STATUSES as readonly string[]).includes(value)
}

/** Names what the command actually answered, for the failure message. */
function describeAnswer(answer: unknown): string {
  if (answer === null) return 'null'
  if (Array.isArray(answer)) return 'an array'
  return typeof answer === 'object' ? 'an object without a usable outcome' : typeof answer
}

export async function backupDatabaseBeforeMigration(
  invoke: NativeInvoke,
): Promise<DatabaseBackupOutcome> {
  const answer = await invoke(BACKUP_COMMAND)
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    throw new Error(
      `The ${BACKUP_COMMAND} command answered with ${describeAnswer(answer)} instead of the outcome object.`,
    )
  }
  const record = answer as Readonly<Record<string, unknown>>
  const status = record.status
  if (!isBackupStatus(status)) {
    throw new Error(
      `The ${BACKUP_COMMAND} command answered with status "${String(status)}", which is not an outcome this build understands.`,
    )
  }
  const path = record.path
  if (status === 'missing-source') {
    if (path !== null) {
      throw new Error(
        `The ${BACKUP_COMMAND} command reported "missing-source" with a path, but no copy was made.`,
      )
    }
    return { status, path: null }
  }
  if (typeof path !== 'string' || path === '') {
    throw new Error(
      `The ${BACKUP_COMMAND} command reported "${status}" without the path of the copy.`,
    )
  }
  return { status, path }
}
