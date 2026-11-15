/**
 * @file backup.test
 * @description The pre-migration copy contract: one native command, one call,
 * and a tagged answer that is either understood or reported. The shape is
 * validated field by field, because the native side and this module ship
 * together and a drift between them must fail loudly instead of silently
 * losing the record of the copy.
 */

import { describe, expect, it, vi } from 'vitest'

import { backupDatabaseBeforeMigration } from '../../../src/infrastructure/persistence/backup'

const COPY_PATH = 'C:/data/re-resume.pre-v2.db'

describe('backupDatabaseBeforeMigration', () => {
  it('asks the native side for the copy exactly once', async () => {
    const invoke = vi.fn(async () => ({ status: 'created', path: COPY_PATH }))

    const outcome = await backupDatabaseBeforeMigration(invoke)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('backup_database_once')
    expect(outcome).toEqual({ status: 'created', path: COPY_PATH })
  })

  it('reports a copy that already existed', async () => {
    const outcome = await backupDatabaseBeforeMigration(async () => ({
      status: 'exists',
      path: COPY_PATH,
    }))
    expect(outcome).toEqual({ status: 'exists', path: COPY_PATH })
  })

  it('reports that there was no database to copy, without a path', async () => {
    const outcome = await backupDatabaseBeforeMigration(async () => ({
      status: 'missing-source',
      path: null,
    }))
    expect(outcome).toEqual({ status: 'missing-source', path: null })
  })

  it('rejects an answer that is not the outcome object', async () => {
    for (const answer of ['created: C:/data/re-resume.pre-v2.db', 42, null, ['created']]) {
      await expect(backupDatabaseBeforeMigration(async () => answer)).rejects.toThrow(
        /instead of the outcome object/,
      )
    }
  })

  it('rejects a status this build does not understand', async () => {
    await expect(
      backupDatabaseBeforeMigration(async () => ({ status: 'copied', path: COPY_PATH })),
    ).rejects.toThrow(/not an outcome this build understands/)
  })

  it('rejects a copy outcome without its destination', async () => {
    for (const status of ['created', 'exists']) {
      await expect(
        backupDatabaseBeforeMigration(async () => ({ status, path: null })),
      ).rejects.toThrow(/without the path of the copy/)
      await expect(
        backupDatabaseBeforeMigration(async () => ({ status, path: '' })),
      ).rejects.toThrow(/without the path of the copy/)
    }
  })

  it('rejects a missing-source answer that carries a path', async () => {
    await expect(
      backupDatabaseBeforeMigration(async () => ({ status: 'missing-source', path: COPY_PATH })),
    ).rejects.toThrow(/"missing-source" with a path/)
  })
})
