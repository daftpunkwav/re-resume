/**
 * @file ProviderSection
 * @description The model-service section of the settings overlay: the configured
 * services, their credential and connection state, and the create/edit flow.
 *
 * Responsibilities:
 * - Read the provider list through the provider capability
 * - Run the connection probe and report latency or a readable failure beside the
 *   row (the probe writes nothing)
 * - Save, switch the active service and delete, then rebuild the root so the
 *   assistant starts using the new configuration
 *
 * Constraints:
 * - The credential is never read back: a row only reports whether one is stored.
 * - A save that changes the serving provider, and every delete or switch, apply
 *   through the same rebuild semantics as the rest of the settings surface: the
 *   failed rebuild keeps the previous root serving.
 */

import { useState } from 'react'
import type { ProviderListItem } from '../../../application/settings/providerConfiguration'
import type { ProviderConnectionTestResult } from '../../../application/settings/testProviderConnection'
import type { SaveProviderInput } from '../../../application/settings/saveProvider'
import type { ProviderKind } from '../../../domain/settings/ProviderConfig'
import { useApplicationRebuild, useServices } from '../ApplicationServicesProvider'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { Notice } from '../components/Notice'
import { showToast } from '../stores/toastStore'
import { useResource } from '../useResource'
import { ProviderForm } from './ProviderForm'
import { messageOf } from './settingsErrors'

const KIND_LABELS: Readonly<Record<ProviderKind, string>> = {
  'openai-compatible': 'OpenAI 兼容接口',
  anthropic: 'Anthropic',
}

type Mode = 'list' | 'create' | 'edit'

export function ProviderSection() {
  const services = useServices()
  const rebuild = useApplicationRebuild()
  const listed = useResource(
    () => services.providers.listProviders(),
    [services.providers],
  )
  const [mode, setMode] = useState<Mode>('list')
  const [editing, setEditing] = useState<ProviderListItem | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [results, setResults] = useState<
    Readonly<Record<string, ProviderConnectionTestResult>>
  >({})
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<ProviderListItem | null>(null)

  const providers = listed.data?.providers ?? null
  const activeProviderId = listed.data?.activeProviderId ?? null
  const loadError = listed.error?.message ?? null

  const save = async (input: SaveProviderInput): Promise<void> => {
    setPendingAction('save')
    setFormError(null)
    try {
      await services.providers.saveProvider(input)
      showToast('success', input.id === null ? '模型服务已添加' : '模型服务已保存')
      setMode('list')
      setEditing(null)
      rebuild()
    } catch (failure) {
      setFormError(messageOf(failure))
    } finally {
      setPendingAction(null)
    }
  }

  const activate = async (provider: ProviderListItem): Promise<void> => {
    setPendingAction(provider.config.id)
    try {
      await services.providers.setActiveProvider({ id: provider.config.id })
      showToast('success', `已切换到「${provider.config.name}」`)
      rebuild()
    } catch (failure) {
      showToast('danger', messageOf(failure))
    } finally {
      setPendingAction(null)
    }
  }

  const remove = async (provider: ProviderListItem): Promise<void> => {
    setDeleteTarget(null)
    setPendingAction(provider.config.id)
    try {
      await services.providers.deleteProvider({ id: provider.config.id })
      showToast('success', `已删除「${provider.config.name}」`)
      rebuild()
    } catch (failure) {
      showToast('danger', messageOf(failure))
    } finally {
      setPendingAction(null)
    }
  }

  const test = async (provider: ProviderListItem): Promise<void> => {
    setTesting((current) => new Set(current).add(provider.config.id))
    try {
      const result = await services.providers.testProviderConnection({ id: provider.config.id })
      setResults((current) => ({ ...current, [provider.config.id]: result }))
    } catch (failure) {
      showToast('danger', messageOf(failure))
    } finally {
      setTesting((current) => {
        const next = new Set(current)
        next.delete(provider.config.id)
        return next
      })
    }
  }

  if (mode !== 'list') {
    return (
      <div className="settings-section">
        <section className="settings-group">
          <h3 className="settings-group-title">
            {mode === 'create' ? '添加模型服务' : '编辑模型服务'}
          </h3>
          <p className="settings-group-description">
            助手通过你配置的服务生成回答。填写后可以先测试连接，再保存生效。
          </p>
          <ProviderForm
            editing={editing}
            busy={pendingAction === 'save'}
            error={formError}
            onSubmit={(input) => {
              void save(input)
            }}
            onCancel={() => {
              setMode('list')
              setEditing(null)
              setFormError(null)
            }}
          />
        </section>
      </div>
    )
  }

  return (
    <div className="settings-section">
      {loadError === null ? null : (
        <Notice tone="danger" title="读取模型服务失败">
          <p>{loadError}</p>
          <div className="settings-inline-actions">
            <Button size="small" variant="secondary" onClick={() => void listed.reload()}>
              重新读取
            </Button>
          </div>
        </Notice>
      )}

      {providers === null ? (
        loadError === null ? <p className="settings-note">正在读取模型服务…</p> : null
      ) : providers.length === 0 ? (
        <EmptyState
          icon="plug"
          title="模型服务未配置"
          description="简历助手需要一个模型服务来生成回答。添加服务地址、模型与 API Key 后即可开始对话。"
          footnote="密钥保存在系统密钥库中，不写入数据库，也不会被导出。"
          action={
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null)
                setFormError(null)
                setMode('create')
              }}
            >
              添加模型服务
            </Button>
          }
        />
      ) : (
        <>
          <div className="settings-status-row">
            <span className="settings-status-label">已配置 {providers.length} 个服务</span>
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                setEditing(null)
                setFormError(null)
                setMode('create')
              }}
            >
              添加服务
            </Button>
          </div>
          <ul className="provider-list">
            {providers.map((provider) => {
              const config = provider.config
              const isActive = activeProviderId === config.id
              const result = results[config.id]
              const isTesting = testing.has(config.id)
              return (
                <li className="provider-row" key={config.id}>
                  <div className="provider-row-main">
                    <div className="provider-row-title">
                      <span className="provider-row-name">{config.name}</span>
                      {isActive ? <Badge tone="success">当前使用</Badge> : null}
                      {provider.hasCredential ? null : <Badge tone="warning">缺少密钥</Badge>}
                    </div>
                    <p className="provider-row-meta">
                      {KIND_LABELS[config.kind]} · {config.modelId}
                    </p>
                    <p className="provider-row-url">{config.baseUrl}</p>
                    {isTesting ? <p className="provider-row-test">正在测试连接…</p> : null}
                    {!isTesting && result !== undefined ? (
                      <p
                        className={
                          result.ok ? 'provider-row-test provider-row-test-ok' : 'provider-row-test provider-row-test-failed'
                        }
                      >
                        {result.ok
                          ? `连接正常，${result.latencyMs.toString()} ms`
                          : `连接失败：${result.detail ?? '服务没有返回可用结果。'}`}
                      </p>
                    ) : null}
                  </div>
                  <div className="provider-row-actions">
                    <Button
                      size="small"
                      variant="ghost"
                      loading={isTesting}
                      disabled={isTesting || pendingAction !== null}
                      onClick={() => void test(provider)}
                    >
                      测试连接
                    </Button>
                    {isActive ? null : (
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={pendingAction !== null}
                        onClick={() => void activate(provider)}
                      >
                        设为当前
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={pendingAction !== null}
                      onClick={() => {
                        setEditing(provider)
                        setFormError(null)
                        setMode('edit')
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={pendingAction !== null}
                      onClick={() => setDeleteTarget(provider)}
                    >
                      删除
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="settings-note">
            修改服务或切换当前服务后，界面会用新的配置重建应用容器；失败时保留正在使用的旧配置。
          </p>
        </>
      )}

      <Dialog
        open={deleteTarget !== null}
        title="删除模型服务"
        description={
          deleteTarget === null
            ? ''
            : `「${deleteTarget.config.name}」的地址、模型与其密钥都会删除。`
        }
        confirmLabel="删除"
        destructive
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget !== null) void remove(deleteTarget)
        }}
      >
        {deleteTarget !== null && deleteTarget.config.isActive ? (
          <p>这个服务正在使用中；删除后助手会进入未配置状态，直到再次添加。</p>
        ) : (
          <p>这个操作不会影响简历与信息库。</p>
        )}
      </Dialog>
    </div>
  )
}
