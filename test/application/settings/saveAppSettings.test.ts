/**
 * @file saveAppSettings.test
 * @description The write half of the settings contract: merge, clamp, reject
 * an enumeration this build does not know, and store exactly once.
 */

import { describe, expect, it, vi } from 'vitest'

import { saveAppSettings } from '../../../src/application/settings/saveAppSettings'
import {
  DEFAULT_APP_SETTINGS,
  PANEL_WIDTH_MAX,
  UI_SCALE_MAX,
} from '../../../src/domain/settings/AppSettings'
import { DomainError } from '../../../src/domain/shared/DomainError'
import { InMemoryAppSettingsRepository } from '../../../src/infrastructure/preview/inMemoryRepositories'

describe('saveAppSettings', () => {
  it('merges a patch without touching anything it does not name', async () => {
    const repository = new InMemoryAppSettingsRepository(DEFAULT_APP_SETTINGS)

    const saved = await saveAppSettings({ settings: repository }, { density: 'compact' })

    expect(saved.density).toBe('compact')
    expect(saved.themeId).toBe(DEFAULT_APP_SETTINGS.themeId)
    expect(saved.panels).toEqual(DEFAULT_APP_SETTINGS.panels)
    await expect(repository.read()).resolves.toEqual(saved)
  })

  it('clamps numbers and rounds the scale to its step', async () => {
    const repository = new InMemoryAppSettingsRepository(null)

    const saved = await saveAppSettings(
      { settings: repository },
      { uiScale: 9, canvasZoom: 0.1 },
    )

    expect(saved.uiScale).toBe(UI_SCALE_MAX)
    expect(saved.canvasZoom).toBe(0.25)
  })

  it('clamps a panel width into the legal range', async () => {
    const repository = new InMemoryAppSettingsRepository(null)

    const saved = await saveAppSettings(
      { settings: repository },
      { panels: { right: 'both', rightWidth: 5000, collapsed: false } },
    )

    expect(saved.panels.right).toBe('both')
    expect(saved.panels.rightWidth).toBe(PANEL_WIDTH_MAX)
  })

  it('rejects an enumeration value this build does not know', async () => {
    const repository = new InMemoryAppSettingsRepository(null)
    const write = vi.spyOn(repository, 'write')

    const attempt = saveAppSettings(
      { settings: repository },
      { themeId: 'unknown' } as unknown as { themeId: 'apple' },
    )

    await expect(attempt).rejects.toBeInstanceOf(DomainError)
    await expect(attempt).rejects.toMatchObject({ code: 'invalidSettings' })
    expect(write).not.toHaveBeenCalled()
  })

  it('writes once per call', async () => {
    const repository = new InMemoryAppSettingsRepository(null)
    const write = vi.spyOn(repository, 'write')

    await saveAppSettings({ settings: repository }, { motion: 'reduced' })

    expect(write).toHaveBeenCalledTimes(1)
  })
})
