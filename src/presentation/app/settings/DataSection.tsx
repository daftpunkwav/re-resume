/**
 * @file DataSection
 * @description The local-data section of the settings overlay.
 *
 * Backup export, import and sample data (PR-09) replace this file with the
 * controls for them. What this build can state truthfully is where the data
 * lives and what it does not yet contain.
 */

import type { AppInfo } from '../../../bootstrap/capabilities'
import { EmptyState } from '../components/EmptyState'
import { useSettingsStore } from '../stores/settingsStore'

export interface DataSectionProps {
  readonly appInfo: AppInfo
}

export function DataSection({ appInfo }: DataSectionProps) {
  const sampleDataSeeded = useSettingsStore((state) => state.settings.sampleDataSeeded)

  return (
    <div className="settings-section">
      <EmptyState
        icon="database"
        title="本地数据"
        description="备份导出、导入与示例数据集中在这个分节。当前没有可导出的简历或对话。"
      />
      <dl className="settings-definition">
        <div className="settings-definition-row">
          <dt>存储位置</dt>
          <dd className="settings-mono">
            {appInfo.databaseFile ?? '浏览器预览：使用内存数据，不写入磁盘'}
          </dd>
        </div>
        <div className="settings-definition-row">
          <dt>示例数据</dt>
          <dd>{sampleDataSeeded ? '已导入' : '尚未导入'}</dd>
        </div>
      </dl>
    </div>
  )
}
