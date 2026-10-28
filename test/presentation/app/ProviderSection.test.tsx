/**
 * @file ProviderSection.test
 * @description The model-service settings surface: the list the capability
 * returns, the connection probe result, the create/edit form and the destructive
 * delete confirmation. The capability is a double, so each test observes exactly
 * the calls the section makes.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApplicationServicesProvider } from '../../../src/presentation/app/ApplicationServicesProvider'
import { ProviderSection } from '../../../src/presentation/app/settings/ProviderSection'
import { useSettingsStore } from '../../../src/presentation/app/stores/settingsStore'
import { useShellStore } from '../../../src/presentation/app/stores/shellStore'
import { useToastStore } from '../../../src/presentation/app/stores/toastStore'
import { DEFAULT_APP_SETTINGS } from '../../../src/domain/settings/AppSettings'
import { providerSecretRef } from '../../../src/domain/settings/ProviderConfig'
import type { ProviderConfig } from '../../../src/domain/settings/ProviderConfig'
import type { ProviderListItem } from '../../../src/application/settings/providerConfiguration'
import { stubCompositionRoot } from '../../support/stubCompositionRoot'

const TIMESTAMP = '2026-01-01T00:00:00.000Z'

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: '网关一号',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'model-1',
    secretRef: providerSecretRef('provider-1'),
    supportsImages: null,
    isActive: true,
    createdAt: TIMESTAMP as never,
    updatedAt: TIMESTAMP as never,
    ...overrides,
  }
}

function providerListItem(overrides: Partial<ProviderConfig> = {}, hasCredential = true): ProviderListItem {
  return { config: config(overrides), hasCredential }
}

function renderSection(providers: ReturnType<typeof createProviderDouble>) {
  const root = stubCompositionRoot({ providers })
  return render(
    <ApplicationServicesProvider
      createRoot={async () => root}
      resolveSnapshotPath={async () => '/tmp/credentials.hold'}
    >
      <ProviderSection />
    </ApplicationServicesProvider>,
  )
}

function createProviderDouble(options: {
  readonly items?: readonly ProviderListItem[]
  readonly activeProviderId?: string | null
}) {
  return {
    listProviders: vi.fn(async () => ({
      providers: options.items ?? [],
      activeProviderId: options.activeProviderId ?? null,
    })),
    saveProvider: vi.fn(async () => ({ config: config(), hasCredential: true })),
    deleteProvider: vi.fn(async () => undefined),
    setActiveProvider: vi.fn(async () => config()),
    testProviderConnection: vi.fn(async () => ({ ok: true, latencyMs: 42 })),
  }
}

beforeEach(() => {
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, status: 'ready', error: null })
  useShellStore.setState({ settingsOpen: true, settingsSection: 'model' })
  useToastStore.setState({ toasts: [] })
})

describe('ProviderSection', () => {
  it('lists the configured services with the active one marked', async () => {
    renderSection(
      createProviderDouble({
        items: [providerListItem(), providerListItem({ id: 'provider-2', name: '备用服务', isActive: false }, false)],
        activeProviderId: 'provider-1',
      }),
    )

    expect(await screen.findByText('网关一号')).toBeInTheDocument()
    expect(screen.getByText('当前使用')).toBeInTheDocument()
    expect(screen.getAllByText('OpenAI 兼容接口 · model-1').length).toBeGreaterThan(0)
    expect(screen.getByText('缺少密钥')).toBeInTheDocument()
  })

  it('shows the empty state with the only action that makes sense', async () => {
    renderSection(createProviderDouble({ items: [] }))

    expect(await screen.findByText('模型服务未配置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加模型服务' })).toBeInTheDocument()
  })

  it('runs the connection probe and reports the latency without saving', async () => {
    const user = userEvent.setup({ delay: null })
    const providers = createProviderDouble({ items: [providerListItem()], activeProviderId: 'provider-1' })
    renderSection(providers)

    await user.click(await screen.findByRole('button', { name: '测试连接' }))

    expect(await screen.findByText('连接正常，42 ms')).toBeInTheDocument()
    expect(providers.testProviderConnection).toHaveBeenCalledWith({ id: 'provider-1' })
    expect(providers.saveProvider).not.toHaveBeenCalled()
  })

  it('validates through the form and saves the submitted values', async () => {
    const user = userEvent.setup({ delay: null })
    const providers = createProviderDouble({ items: [] })
    renderSection(providers)

    await user.click(await screen.findByRole('button', { name: '添加模型服务' }))
    await user.type(screen.getByLabelText('名称'), '本地网关')
    await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1')
    await user.type(screen.getByLabelText('模型 ID'), 'model-2')
    await user.type(screen.getByLabelText('API Key'), 'secret-key')
    await user.click(screen.getByRole('button', { name: '添加模型服务' }))

    await waitFor(() =>
      expect(providers.saveProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '本地网关',
          baseUrl: 'https://api.example.com/v1',
          modelId: 'model-2',
          apiKey: 'secret-key',
          supportsImages: null,
        }),
      ),
    )
  })

  it('switches the active service', async () => {
    const user = userEvent.setup({ delay: null })
    const providers = createProviderDouble({
      items: [
        providerListItem(),
        providerListItem({ id: 'provider-2', name: '备用服务', isActive: false }),
      ],
      activeProviderId: 'provider-1',
    })
    renderSection(providers)
    await screen.findByText('备用服务')

    await user.click(screen.getByRole('button', { name: '设为当前' }))

    await waitFor(() =>
      expect(providers.setActiveProvider).toHaveBeenCalledWith({ id: 'provider-2' }),
    )
  })

  it('deletes a service only after the confirmation', async () => {
    const user = userEvent.setup({ delay: null })
    const providers = createProviderDouble({
      items: [providerListItem()],
      activeProviderId: 'provider-1',
    })
    renderSection(providers)
    await screen.findByText('网关一号')

    await user.click(screen.getByRole('button', { name: '删除' }))
    const dialog = await screen.findByRole('dialog', { name: '删除模型服务' })
    expect(providers.deleteProvider).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() =>
      expect(providers.deleteProvider).toHaveBeenCalledWith({ id: 'provider-1' }),
    )
  })
})
