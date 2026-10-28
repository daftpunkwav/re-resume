/**
 * @file AboutSection
 * @description Build facts about the running window: version, mode, container
 * and licence.
 */

import type { AppInfo } from '../../../bootstrap/capabilities'

export interface AboutSectionProps {
  readonly appInfo: AppInfo
}

const RUNTIME_LABELS: Readonly<Record<AppInfo['runtime'], string>> = {
  tauri: 'Tauri 桌面容器',
  browser: '浏览器预览',
}

export function AboutSection({ appInfo }: AboutSectionProps) {
  return (
    <div className="settings-section">
      <dl className="settings-definition">
        <div className="settings-definition-row">
          <dt>版本</dt>
          <dd className="settings-mono">{appInfo.version}</dd>
        </div>
        <div className="settings-definition-row">
          <dt>构建</dt>
          <dd className="settings-mono">{appInfo.buildMode}</dd>
        </div>
        <div className="settings-definition-row">
          <dt>运行环境</dt>
          <dd>{RUNTIME_LABELS[appInfo.runtime]}</dd>
        </div>
        <div className="settings-definition-row">
          <dt>许可证</dt>
          <dd>{appInfo.license}</dd>
        </div>
      </dl>
      <p className="settings-note">
        数据保存在本机；只有你配置的模型服务会收到请求内容。
      </p>
    </div>
  )
}
