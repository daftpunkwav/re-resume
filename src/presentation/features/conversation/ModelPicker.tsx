/**
 * @file ModelPicker
 * @description The model-service control in the conversation header. It lists
 * the configured services, switches the one serving requests, runs the
 * three-second connectivity probe, and turns into a setup entry when nothing is
 * configured.
 *
 * Constraints:
 * - Switching the service rebuilds the composition root: the adapters are built
 *   once per root. The caller hands in the rebuild it receives from the boot
 *   provider, and a failed switch leaves the current root serving.
 * - The picker never shows or receives a credential.
 */

import { useState } from 'react'
import { useApplicationRebuild } from '../../app/ApplicationServicesProvider'
import { Badge } from '../../app/components/Badge'
import { Button } from '../../app/components/Button'
import { Popover } from '../../app/components/Popover'
import { Spinner } from '../../app/components/Spinner'
import { useShellStore } from '../../app/stores/shellStore'
import { useProviderStore } from './stores/providerStore'
import { FeatureIcon } from './icons'

export function ModelPicker() {
  const rebuild = useApplicationRebuild()
  const openSettings = useShellStore((state) => state.openSettings)
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const status = useProviderStore((state) => state.status)
  const tested = useProviderStore((state) => state.tested)
  const testing = useProviderStore((state) => state.testing)
  const error = useProviderStore((state) => state.error)
  const setActive = useProviderStore((state) => state.setActive)
  const testConnection = useProviderStore((state) => state.testConnection)
  const [open, setOpen] = useState(false)

  const active = providers.find((entry) => entry.config.id === activeProviderId) ?? null
  const probe = active === null ? undefined : tested[active.config.id]
  const tone: 'neutral' | 'warning' | 'success' | 'danger' =
    probe === undefined ? 'warning' : probe.ok ? 'success' : 'danger'

  if (status === 'ready' && providers.length === 0) {
    return (
      <button
        type="button"
        className="model-chip model-chip-unconfigured"
        onClick={() => openSettings('model')}
      >
        <FeatureIcon name="plug" size={14} />
        <span className="model-chip-label">配置模型服务</span>
      </button>
    )
  }

  return (
    <div className="popover-anchor">
      <button
        type="button"
        className="model-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          active === null
            ? '选择模型服务'
            : `当前模型服务：${active.config.name}，打开模型服务列表`
        }
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />
        <span className="model-chip-label">
          {active?.config.name ?? (status === 'loading' ? '读取模型服务…' : '选择模型服务')}
        </span>
        <span className="model-chip-chevron" aria-hidden="true">
          <FeatureIcon name="chevron-down" size={13} />
        </span>
      </button>
      <Popover open={open} label="模型服务" align="end" onClose={() => setOpen(false)}>
        <p className="popover-title">模型服务</p>
        <p className="popover-body">助手将通过选中的服务生成回答，切换后立即生效。</p>
        <div className="provider-list" role="listbox" aria-label="已配置的模型服务">
          {providers.map((entry) => {
            const selected = entry.config.id === activeProviderId
            return (
              <button
                key={entry.config.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={selected ? 'provider-option provider-option-selected' : 'provider-option'}
                onClick={() => {
                  if (selected) {
                    setOpen(false)
                    return
                  }
                  void setActive(entry.config.id).then((switched) => {
                    if (!switched) return
                    setOpen(false)
                    rebuild()
                  })
                }}
              >
                <span className="provider-option-main">
                  <span className="provider-option-name">{entry.config.name}</span>
                  <span className="provider-option-model">{entry.config.modelId}</span>
                </span>
                {entry.hasCredential ? null : <Badge tone="warning">缺少密钥</Badge>}
                {selected ? (
                  <span className="provider-option-mark" aria-hidden="true">
                    <FeatureIcon name="check-circle" size={15} />
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        {active === null ? null : (
          <div className="provider-probe">
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                void testConnection(active.config.id)
              }}
              disabled={testing.has(active.config.id) || !active.hasCredential}
              loading={testing.has(active.config.id)}
            >
              测试连接
            </Button>
            {testing.has(active.config.id) ? <Spinner label="正在测试连接" /> : null}
            {probe === undefined ? null : (
              <span
                className={probe.ok ? 'provider-probe-ok' : 'provider-probe-failed'}
                role="status"
              >
                {probe.ok
                  ? `连接正常 · ${probe.latencyMs.toString()} ms`
                  : (probe.detail ?? '连接失败')}
              </span>
            )}
          </div>
        )}
        {error === null ? null : <p className="provider-error">{error.message}</p>}
        <Button
          size="small"
          variant="ghost"
          onClick={() => {
            setOpen(false)
            openSettings('model')
          }}
        >
          管理模型服务
        </Button>
      </Popover>
    </div>
  )
}
