/**
 * @file backup.test
 * @description The pre-migration copy contract: one native command, one call,
 * and an answer that is either understood or reported.
 */

import { describe, expect, it, vi } from 'vitest'

import { backupDatabaseBeforeMigration } from '../../../src/infrastructure/persistence/backup'

describe('backupDatabaseBeforeMigration', () => {
  it('asks the native side for the copy exactly once', async () => {
    const invoke = vi.fn(async () => 'created: C:/data/re-resume.pre-v2.db')

    const outcome = await backupDatabaseBeforeMigration(invoke)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('backup_database_once')
    expect(outcome).toEqual({
      status: 'created',
      detail: 'C:/data/re-resume.pre-v2.db',
    })
  })

  it('reports a copy that already existed', async () => {
    const outcome = await backupDatabaseBeforeMigration(
      async () => 'exists: C:/data/re-resume.pre-v2.db',
    )
    expect(outcome.status).toBe('exists')
  })

  it('reports that there was no database to copy', async () => {
    const outcome = await backupDatabaseBeforeMigration(async () => 'no-source')
    expect(outcome.status).toBe('missing-source')
  })

  it('rejects an answer this build does not understand', async () => {
    await expect(backupDatabaseBeforeMigration(async () => 'ok')).rejects.toThrow(
      /not an outcome this build understands/,
    )
    await expect(backupDatabaseBeforeMigration(async () => 42)).rejects.toThrow(
      /instead of the outcome string/,
    )
  })
})
