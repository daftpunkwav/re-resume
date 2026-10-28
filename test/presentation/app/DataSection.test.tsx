/**
 * @file DataSection.test
 * @description The data settings surface: export, the validated import with its
 * confirmation, the typed clear confirmation, the orphan sweep, the sample
 * action, and the honest state of the browser preview.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationServicesProvider } from '../../../src/presentation/app/ApplicationServicesProvider'
import { DataSection } from '../../../src/presentation/app/settings/DataSection'
import { useSettingsStore } from '../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../src/presentation/app/stores/shellStore'
import { useToastStore } from '../../../src/presentation/app/stores/toastStore'
import { DEFAULT_APP_SETTINGS } from '../../../src/domain/settings/AppSettings'
import {
  BACKUP_APP_MARKER,
  BACKUP_DOCUMENT_VERSION,
  BACKUP_SCHEMA_VERSION,
} from '../../../src/domain/backup/BackupDocument'
import type { BackupDocument } from '../../../src/domain/backup/BackupDocument'
import type { AppInfo } from '../../../src/bootstrap/capabilities'
import { stubCompositionRoot } from '../../support/stubCompositionRoot'
import { emptyTables } from '../../support/backupFixtures'

const APP_INFO: AppInfo = {
  version: '0.0.0-test',
  buildMode: 'test',
  runtime: 'tauri',
  license: 'MIT',
  databaseFile: 'C:/Users/test/AppData/Roaming/re-resume/re-resume.db',
}

const DOCUMENT: BackupDocument = {
  v: BACKUP_DOCUMENT_VERSION,
  app: BACKUP_APP_MARKER,
  exportedAt: '2026-01-01T00:00:00.000Z' as never,
  schemaVersion: BACKUP_SCHEMA_VERSION,
  tables: emptyTables(),
  attachments: [],
}

function createBackupDouble() {
  return {
    canManageData: true,
    exportDocument: vi.fn(async () => DOCUMENT),
    inspectDocument: vi.fn(() => ({ tables: { app_settings: 1 }, attachments: 0 })),
    importDocument: vi.fn(async () => ({ tables: { app_settings: 1 }, attachments: 0 })),
    clearAllData: vi.fn(async () => ({
      removedAttachments: 2,
      removedSecrets: 1,
      undeletedFiles: [],
      undeletedSecrets: [],
    })),
    cleanupOrphanAttachments: vi.fn(async () => ({ removed: 1, undeletedFiles: [] })),
  }
}

function renderSection(
  backup: ReturnType<typeof createBackupDouble>,
  seedSampleData = vi.fn(async () => ({
    alreadySeeded: false,
    infoEntries: 23,
    resumes: 2,
    messages: 3,
    conversationId: null,
  })),
  info: AppInfo = APP_INFO,
) {
  const root = stubCompositionRoot({
    backup,
    seed: { seedSampleData },
    appInfo: info,
  })
  return {
    backup,
    seedSampleData,
    ...render(
      <ApplicationServicesProvider
        createRoot={async () => root}
        resolveSnapshotPath={async () => '/tmp/credentials.hold'}
      >
        <DataSection appInfo={info} />
      </ApplicationServicesProvider>,
    ),
  }
}

beforeEach(() => {
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, status: 'ready', error: null })
  useShellStore.setState({ settingsOpen: true, settingsSection: 'data' })
  useToastStore.setState({ toasts: [] })
})

describe('DataSection', () => {
  it('shows where the database lives and the backup format', async () => {
    renderSection(createBackupDouble())

    expect(await screen.findByText(APP_INFO.databaseFile as string)).toBeInTheDocument()
    expect(screen.getByText(/ReResume 备份 v1/)).toBeInTheDocument()
  })

  it('exports a document and offers it as a file', async () => {
    const user = userEvent.setup({ delay: null })
    const createObjectURL = vi.fn(() => 'blob:backup')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const { backup } = renderSection(createBackupDouble())

    await user.click(await screen.findByRole('button', { name: '导出备份' }))

    await waitFor(() => expect(backup.exportDocument).toHaveBeenCalledTimes(1))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('validates an import first, names the counts, then applies it', async () => {
    const user = userEvent.setup({ delay: null })
    const { backup } = renderSection(createBackupDouble())

    const file = new File([JSON.stringify(DOCUMENT)], 'backup.json', {
      type: 'application/json',
    })
    await user.upload(await screen.findByLabelText('选择备份文件'), file)

    const dialog = await screen.findByRole('dialog', { name: '导入备份' })
    expect(within(dialog).getByText(/1 行数据与 0 个附件/)).toBeInTheDocument()
    expect(backup.importDocument).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '替换当前数据' }))
    await waitFor(() => expect(backup.importDocument).toHaveBeenCalledTimes(1))
    expect(backup.inspectDocument).toHaveBeenCalledTimes(1)
  })

  it('refuses a malformed file with a readable reason', async () => {
    const user = userEvent.setup({ delay: null })
    const { backup } = renderSection(createBackupDouble())
    backup.inspectDocument.mockImplementation(() => {
      throw new Error('备份文件无效：schemaVersion 不是这个版本')
    })

    const file = new File(['{"v":9}'], 'backup.json', { type: 'application/json' })
    await user.upload(await screen.findByLabelText('选择备份文件'), file)

    expect(await screen.findByText(/备份文件无效/)).toBeInTheDocument()
    expect(backup.importDocument).not.toHaveBeenCalled()
  })

  it('requires the typed confirmation before clearing', async () => {
    const user = userEvent.setup({ delay: null })
    const { backup } = renderSection(createBackupDouble())

    await user.click(await screen.findByRole('button', { name: '清空全部数据' }))
    const confirm = screen.getByRole('button', { name: '确认清空' })
    expect(confirm).toBeDisabled()

    await user.type(screen.getByLabelText('输入「清空」以确认'), '清空')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(backup.clearAllData).toHaveBeenCalledTimes(1))
  })

  it('runs the orphan sweep and reports what it removed', async () => {
    const user = userEvent.setup({ delay: null })
    const { backup } = renderSection(createBackupDouble())

    await user.click(await screen.findByRole('button', { name: '清理未使用附件' }))

    await waitFor(() => expect(backup.cleanupOrphanAttachments).toHaveBeenCalledTimes(1))
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('1 个未使用的附件')
  })

  it('imports the sample data and reports the already-seeded case', async () => {
    const user = userEvent.setup({ delay: null })
    const { seedSampleData } = renderSection(createBackupDouble())

    await user.click(await screen.findByRole('button', { name: '导入示例数据' }))
    await waitFor(() => expect(seedSampleData).toHaveBeenCalledTimes(1))
  })

  it('states the preview limitation instead of showing working file actions', async () => {
    const backup = { ...createBackupDouble(), canManageData: false }
    renderSection(backup, undefined, { ...APP_INFO, runtime: 'browser', databaseFile: null })

    expect(await screen.findByText('浏览器预览不写入磁盘')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出备份' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导入备份' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导入示例数据' })).toBeEnabled()
  })
})
