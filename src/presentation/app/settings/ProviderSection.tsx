/**
 * @file ProviderSection
 * @description The model-service section of the settings overlay.
 *
 * Provider configuration (PR-09) replaces this file with the provider list and
 * form. This build has no provider use cases, so the section reports the state
 * honestly instead of showing a form whose save would go nowhere.
 */

import { Badge } from '../components/Badge'
import { EmptyState } from '../components/EmptyState'
import { describeProviderStatus } from '../providerStatus'
import { useSettingsStore } from '../stores/settingsStore'

export function ProviderSection() {
  const activeProviderId = useSettingsStore((state) => state.settings.activeProviderId)
  const status = describeProviderStatus(activeProviderId)

  return (
    <div className="settings-section">
      <div className="settings-status-row">
        <span className="settings-status-label">当前状态</span>
        <Badge tone={status.tone === 'warning' ? 'warning' : 'neutral'}>{status.label}</Badge>
      </div>
      <EmptyState
        icon="plug"
        title={status.label}
        description="模型服务用于驱动简历助手。当前没有已配置的服务，助手无法发起对话。"
        footnote="服务地址、模型与密钥在配置建立后由这个分节管理。"
      />
    </div>
  )
}
