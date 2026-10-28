/**
 * @file readAppSettings.test
 * @description The first read of the preferences: an existing row is returned
 * as it is, and an absent one is seeded once with the defaults.
 */

import { describe, expect, it, vi } from 'vitest'

import { readAppSettings } from '../../../src/application/settings/readAppSettings'
import { DEFAULT_APP_SETTINGS } from '../../../src/domain/settings/AppSettings'
import { InMemoryAppSettingsRepository } from '../../../src/infrastructure/preview/inMemoryRepositories'

describe('readAppSettings', () => {
  it('returns the stored value without writing it again', async () => {
    const stored = { ...DEFAULT_APP_SETTINGS, uiScale: 1.2 }
    const repository = new InMemoryAppSettingsRepository(stored)
    const write = vi.spyOn(repository, 'write')

    await expect(readAppSettings({ settings: repository })).resolves.toEqual(stored)
    expect(write).not.toHaveBeenCalled()
  })

  it('seeds the defaults when nothing has been stored', async () => {
    const repository = new InMemoryAppSettingsRepository(null)

    await expect(readAppSettings({ settings: repository })).resolves.toEqual(DEFAULT_APP_SETTINGS)
    await expect(repository.read()).resolves.toEqual(DEFAULT_APP_SETTINGS)
  })
})
