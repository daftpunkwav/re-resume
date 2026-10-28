/**
 * @file appSettings wiring
 * @description Wires the settings-area use cases to the repositories they need:
 * the preferences value and the backup/data operations. One file per area, so
 * the assembly of one area changes without touching the others.
 */

import { readAppSettings } from '../../application/settings/readAppSettings'
import { saveAppSettings } from '../../application/settings/saveAppSettings'
import { clearAllData } from '../../application/settings/clearAllData'
import { cleanupOrphanAttachments } from '../../application/settings/cleanupOrphanAttachments'
import { exportBackup } from '../../application/settings/exportBackup'
import { importBackup, inspectBackup } from '../../application/settings/importBackup'
import type { AppSettings } from '../../domain/settings/AppSettings'
import type { AppSettingsRepository } from '../../domain/settings/ports/AppSettingsRepository'
import type { BackupStore } from '../../domain/backup/ports/BackupStore'
import type { FileStore } from '../../domain/conversation/ports/FileStore'
import type { SecretStore } from '../../domain/generation/ports/SecretStore'
import type { Clock } from '../../domain/shared/Clock'
import type { AppSettingsService, BackupService } from '../capabilities'

export interface AppSettingsWiring {
  readonly repository: AppSettingsRepository
}

export function createAppSettingsService(wiring: AppSettingsWiring): AppSettingsService {
  return {
    read: () => readAppSettings({ settings: wiring.repository }),
    save: (patch: Partial<AppSettings>) =>
      saveAppSettings({ settings: wiring.repository }, patch),
  }
}

export interface BackupWiring {
  /** True when the root writes persistent data and can manage backups. */
  readonly canManageData: boolean
  readonly backup: BackupStore
  readonly files: FileStore
  readonly secrets: SecretStore
  readonly clock: Clock
}

export function createBackupService(wiring: BackupWiring): BackupService {
  const disabledReason =
    '浏览器预览使用内存数据，不写入磁盘；备份与清空只在桌面版可用。'
  if (!wiring.canManageData) {
    const refuse = async (): Promise<never> => {
      throw new Error(disabledReason)
    }
    return {
      canManageData: false,
      exportDocument: refuse,
      inspectDocument: () => {
        throw new Error(disabledReason)
      },
      importDocument: refuse,
      clearAllData: refuse,
      cleanupOrphanAttachments: refuse,
    }
  }
  return {
    canManageData: true,
    exportDocument: () => exportBackup(wiring),
    inspectDocument: (raw) => inspectBackup(raw),
    importDocument: (raw) => importBackup(wiring, raw),
    clearAllData: () => clearAllData(wiring),
    cleanupOrphanAttachments: () => cleanupOrphanAttachments({ ...wiring }),
  }
}
