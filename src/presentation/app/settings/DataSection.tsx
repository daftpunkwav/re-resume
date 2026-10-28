/**
 * @file DataSection
 * @description The local-data section of the settings overlay: where the data
 * lives, the backup file, the destructive clear, the orphan attachment sweep and
 * the sample library.
 *
 * Responsibilities:
 * - Export the whole database as one JSON file the user chooses where to keep
 * - Validate an imported file, ask for confirmation with the row counts, then
 *   restore it and rebuild the root
 * - Guard the destructive clear behind typing 「清空」
 * - Import the sample data once and rebuild so every panel sees it
 *
 * Constraints:
 * - Restoring replaces everything, so validation happens before the confirmation
 *   and nothing is written before it; the confirmation names the counts so the
 *   user knows what is being replaced.
 * - The browser preview has no file to back up; the section states that and
 *   disables the file actions instead of pretending they worked.
 * - Credentials are not part of a backup: the confirmation says so explicitly.
 */

import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { BackupImportSummary } from '../../../domain/backup/BackupDocument'
import { BACKUP_SCHEMA_VERSION } from '../../../domain/backup/BackupDocument'
import type { AppInfo } from '../../../bootstrap/capabilities'
import { useApplicationRebuild, useServices } from '../ApplicationServicesProvider'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { Notice } from '../components/Notice'
import { TextField } from '../components/TextField'
import { useSettingsStore } from '../stores/settingsStore'
import { showToast } from '../stores/toastStore'
import { messageOf } from './settingsErrors'

export interface DataSectionProps {
  readonly appInfo: AppInfo
}

const CLEAR_CONFIRMATION = '清空'

function backupFileName(now: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `re-resume-backup-${now.getFullYear().toString()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}.json`
}

/** Hands the user a file without a native dependency: the browser's download. */
function downloadTextFile(fileName: string, text: string): void {
  const anchor = document.createElement('a')
  anchor.download = fileName
  if (typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    anchor.href = url
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 0)
    return
  }
  anchor.href = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

export function DataSection({ appInfo }: DataSectionProps) {
  const services = useServices()
  const rebuild = useApplicationRebuild()
  const sampleDataSeeded = useSettingsStore((state) => state.settings.sampleDataSeeded)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<{
    readonly raw: unknown
    readonly summary: BackupImportSummary
  } | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearText, setClearText] = useState('')

  const canManageData = services.backup.canManageData
  const seeding = busy === 'seed'
  const clearReady = clearText === CLEAR_CONFIRMATION

  const exportBackup = async (): Promise<void> => {
    setBusy('export')
    setError(null)
    try {
      const document = await services.backup.exportDocument()
      downloadTextFile(backupFileName(new Date()), JSON.stringify(document, null, 2))
      showToast('success', '备份文件已生成')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(null)
    }
  }

  const chooseImport = (): void => {
    setError(null)
    fileInput.current?.click()
  }

  const readImport = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    setBusy('inspect')
    setError(null)
    try {
      const text = await file.text()
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        throw new Error('文件不是合法的 JSON。')
      }
      const summary = services.backup.inspectDocument(raw)
      setPendingImport({ raw, summary })
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(null)
    }
  }

  const applyImport = async (): Promise<void> => {
    if (pendingImport === null) return
    const { raw } = pendingImport
    setPendingImport(null)
    setBusy('import')
    setError(null)
    try {
      await services.backup.importDocument(raw)
      showToast('success', '备份已恢复，正在重新加载本地数据')
      rebuild()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(null)
    }
  }

  const clearAll = async (): Promise<void> => {
    setClearOpen(false)
    setClearText('')
    setBusy('clear')
    setError(null)
    try {
      const result = await services.backup.clearAllData()
      const leftovers = result.undeletedFiles.length + result.undeletedSecrets.length
      showToast(
        leftovers > 0 ? 'danger' : 'success',
        leftovers > 0
          ? `数据已清空，但有 ${leftovers.toString()} 项未能删除，请稍后重试。`
          : result.removedAttachments > 0
            ? `本地数据已清空（含 ${result.removedAttachments.toString()} 个附件文件）`
            : '本地数据已清空',
      )
      rebuild()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(null)
    }
  }

  const cleanup = async (): Promise<void> => {
    setBusy('cleanup')
    setError(null)
    try {
      const result = await services.backup.cleanupOrphanAttachments()
      showToast(
        'info',
        result.removed === 0
          ? '没有需要清理的附件'
          : `已清理 ${result.removed.toString()} 个未使用的附件`,
      )
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(null)
    }
  }

  const seed = async (): Promise<void> => {
    setBusy('seed')
    setError(null)
    try {
      const result = await services.seed.seedSampleData()
      showToast(
        'success',
        result.alreadySeeded
          ? '示例数据已经导入过了'
          : '示例数据已导入，正在重新加载本地数据',
      )
      rebuild()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="settings-section">
      <dl className="settings-definition">
        <div className="settings-definition-row">
          <dt>存储位置</dt>
          <dd className="settings-mono">
            {appInfo.databaseFile ?? '浏览器预览：使用内存数据，不写入磁盘'}
          </dd>
        </div>
        <div className="settings-definition-row">
          <dt>备份格式</dt>
          <dd>ReResume 备份 v1 · 数据库 schema {BACKUP_SCHEMA_VERSION}</dd>
        </div>
        <div className="settings-definition-row">
          <dt>示例数据</dt>
          <dd>{sampleDataSeeded ? '已导入' : '尚未导入'}</dd>
        </div>
      </dl>

      {canManageData ? null : (
        <Notice tone="info" title="浏览器预览不写入磁盘">
          <p>
            当前窗口用内存数据运行，备份、导入与清空只在桌面版可用；示例数据可以在预览中导入，用于查看完整界面。
          </p>
        </Notice>
      )}

      {error === null ? null : (
        <Notice
          tone="danger"
          title="操作没有完成"
          actions={
            <Button size="small" variant="ghost" onClick={() => setError(null)}>
              知道了
            </Button>
          }
        >
          <p>{error}</p>
        </Notice>
      )}

      <section className="settings-group">
        <h3 className="settings-group-title">备份</h3>
        <p className="settings-group-description">
          导出会生成一个 JSON 文件，包含数据库中的全部行与附件内容。导入会整体替换当前数据；密钥不包含在备份中，恢复后需要重新填写。
        </p>
        <div className="settings-inline-actions">
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            aria-label="选择备份文件"
            onChange={(event) => {
              void readImport(event)
            }}
          />
          <Button
            variant="secondary"
            disabled={!canManageData || busy !== null}
            loading={busy === 'export'}
            onClick={() => void exportBackup()}
          >
            导出备份
          </Button>
          <Button
            variant="secondary"
            disabled={!canManageData || busy !== null}
            loading={busy === 'inspect'}
            onClick={chooseImport}
          >
            导入备份
          </Button>
          <Button
            variant="ghost"
            disabled={!canManageData || busy !== null}
            loading={busy === 'cleanup'}
            onClick={() => void cleanup()}
          >
            清理未使用附件
          </Button>
        </div>
      </section>

      <section className="settings-group">
        <h3 className="settings-group-title">示例数据</h3>
        <p className="settings-group-description">
          导入一位虚构候选人的完整资料：信息库各模块、一个自定义模块、两份简历与一段示例对话，用来快速体验完整流程。
        </p>
        <div className="settings-inline-actions">
          <Button
            variant={sampleDataSeeded ? 'ghost' : 'primary'}
            disabled={sampleDataSeeded || busy !== null}
            loading={seeding}
            onClick={() => void seed()}
          >
            {sampleDataSeeded ? '示例数据已导入' : '导入示例数据'}
          </Button>
        </div>
      </section>

      <section className="settings-group settings-group-danger">
        <h3 className="settings-group-title">清空全部数据</h3>
        <p className="settings-group-description">
          删除数据库中的所有内容与附件文件，包括简历、信息库、对话和模型服务配置。此操作不可撤销，建议先导出备份。
        </p>
        {clearOpen ? (
          <div className="settings-confirm">
            <TextField
              label={`输入「${CLEAR_CONFIRMATION}」以确认`}
              value={clearText}
              autoComplete="off"
              onChange={(event) => setClearText(event.target.value)}
            />
            <div className="settings-inline-actions">
              <Button
                variant="danger"
                disabled={!clearReady || busy !== null}
                loading={busy === 'clear'}
                onClick={() => void clearAll()}
              >
                确认清空
              </Button>
              <Button
                variant="ghost"
                disabled={busy === 'clear'}
                onClick={() => {
                  setClearOpen(false)
                  setClearText('')
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="settings-inline-actions">
            <Button
              variant="danger"
              disabled={!canManageData || busy !== null}
              onClick={() => setClearOpen(true)}
            >
              清空全部数据
            </Button>
          </div>
        )}
      </section>

      <Dialog
        open={pendingImport !== null}
        title="导入备份"
        description="导入会整体替换当前数据。确认前不会写入任何内容。"
        confirmLabel="替换当前数据"
        destructive
        busy={busy === 'import'}
        onClose={() => setPendingImport(null)}
        onConfirm={() => void applyImport()}
      >
        {pendingImport === null ? null : (
          <>
            <p>
              备份包含{' '}
              {Object.values(pendingImport.summary.tables).reduce(
                (sum, count) => sum + count,
                0,
              )}{' '}
              行数据与 {pendingImport.summary.attachments} 个附件。
            </p>
            <p>
              导入会清空当前数据并替换为备份内容。模型服务的配置会恢复，但 API Key
              不会，需要重新填写。
            </p>
          </>
        )}
      </Dialog>
    </div>
  )
}
