/**
 * @file providers.test
 * @description The model-service use cases: validation at the save boundary, the
 * credential staying out of the configuration row, one active provider, the
 * connection probe, and the cleanup on delete.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { deleteProvider } from '../../../src/application/settings/deleteProvider'
import { listProviders } from '../../../src/application/settings/listProviders'
import { saveProvider } from '../../../src/application/settings/saveProvider'
import { setActiveProvider } from '../../../src/application/settings/setActiveProvider'
import { testProviderConnection } from '../../../src/application/settings/testProviderConnection'
import type { ProviderFactory } from '../../../src/application/settings/testProviderConnection'
import type { ProviderConfigurationDeps } from '../../../src/application/settings/providerConfiguration'
import { isDomainError } from '../../../src/domain/shared/DomainError'
import type { ProviderConfig } from '../../../src/domain/settings/ProviderConfig'
import { providerSecretRef } from '../../../src/domain/settings/ProviderConfig'
import type { ModelProvider } from '../../../src/domain/generation/ports/ModelProvider'
import {
  InMemoryAppSettingsRepository,
  InMemoryProviderConfigRepository,
  InMemorySecretStore,
} from '../../../src/infrastructure/preview/inMemoryRepositories'
import { ScriptedModelProvider } from '../../../src/infrastructure/preview/ScriptedModelProvider'
import { ModelCallError } from '../../../src/infrastructure/http/ProviderAdapters/errors'
import { FixedClock, SequentialIdGenerator } from '../../support/fakeEnvironment'

let deps: ProviderConfigurationDeps
let providers: InMemoryProviderConfigRepository
let settings: InMemoryAppSettingsRepository
let secrets: InMemorySecretStore

beforeEach(() => {
  providers = new InMemoryProviderConfigRepository()
  settings = new InMemoryAppSettingsRepository()
  secrets = new InMemorySecretStore()
  deps = {
    providers,
    settings,
    secrets,
    clock: new FixedClock(),
    ids: new SequentialIdGenerator('provider'),
  }
})

function expectDomainCode(error: unknown, code: string): void {
  expect(isDomainError(error)).toBe(true)
  expect((error as { code: string }).code).toBe(code)
}

function validInput() {
  return {
    name: '我的模型服务',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'gpt-test',
    apiKey: 'secret-key-value',
  }
}

describe('saveProvider', () => {
  it('stores the row, the credential and the first active choice', async () => {
    const saved = await saveProvider(deps, validInput())

    expect(saved.config).toMatchObject({
      name: '我的模型服务',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'gpt-test',
      secretRef: providerSecretRef(saved.config.id),
      isActive: true,
    })
    expect(saved.hasCredential).toBe(true)
    await expect(secrets.load(saved.config.secretRef)).resolves.toBe('secret-key-value')
    const stored = await settings.read()
    expect(stored?.activeProviderId).toBe(saved.config.id)
  })

  it('keeps the credential out of the configuration row', async () => {
    const saved = await saveProvider(deps, validInput())
    const row = await providers.findById(saved.config.id)

    expect(JSON.stringify(row)).not.toContain('secret-key-value')
    expect(row?.secretRef).toBe(providerSecretRef(saved.config.id))
  })

  it('adds a second provider without stealing the active claim', async () => {
    const first = await saveProvider(deps, validInput())
    const second = await saveProvider(deps, { ...validInput(), name: '备用服务' })

    expect(second.config.isActive).toBe(false)
    await expect(providers.findActive()).resolves.toMatchObject({ id: first.config.id })
  })

  it('keeps the credential and creation time when no key is submitted', async () => {
    const first = await saveProvider(deps, validInput())
    const edited = await saveProvider(deps, {
      id: first.config.id,
      name: '改名后的服务',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'gpt-test-2',
    })

    expect(edited.config.createdAt).toBe(first.config.createdAt)
    await expect(secrets.load(edited.config.secretRef)).resolves.toBe('secret-key-value')
    await expect(providers.findById(first.config.id)).resolves.toMatchObject({
      name: '改名后的服务',
      modelId: 'gpt-test-2',
    })
  })

  it.each([
    ['http://api.example.com/v1', 'invalidSettings'],
    ['not a url', 'invalidSettings'],
    ['https://user:pass@api.example.com', 'invalidSettings'],
    ['', 'blankRequiredField'],
  ])('refuses the endpoint %j', async (baseUrl, code) => {
    await expect(saveProvider(deps, { ...validInput(), baseUrl })).rejects.toSatisfy(
      (error: unknown) => {
        expectDomainCode(error, code)
        return true
      },
    )
  })

  it('accepts a plain http endpoint only on the local machine', async () => {
    const saved = await saveProvider(deps, {
      ...validInput(),
      baseUrl: 'http://localhost:11434/v1',
    })
    expect(saved.config.baseUrl).toBe('http://localhost:11434/v1')
  })

  it('refuses a blank name and an over-long model name', async () => {
    await expect(saveProvider(deps, { ...validInput(), name: '  ' })).rejects.toSatisfy(
      (error: unknown) => {
        expectDomainCode(error, 'blankRequiredField')
        return true
      },
    )
    await expect(
      saveProvider(deps, { ...validInput(), modelId: 'm'.repeat(200) }),
    ).rejects.toSatisfy((error: unknown) => {
      expectDomainCode(error, 'fieldTooLong')
      return true
    })
  })

  it('refuses to edit a provider that does not exist', async () => {
    await expect(saveProvider(deps, { ...validInput(), id: 'missing' })).rejects.toSatisfy(
      (error: unknown) => {
        expectDomainCode(error, 'providerNotFound')
        return true
      },
    )
  })
})

describe('listProviders', () => {
  it('reports the credential state and the active provider', async () => {
    const first = await saveProvider(deps, validInput())
    const second = await saveProvider(deps, { ...validInput(), name: '无密钥服务', apiKey: undefined })

    const listed = await listProviders(deps)

    expect(listed.activeProviderId).toBe(first.config.id)
    expect(listed.providers.map((entry) => [entry.config.name, entry.hasCredential])).toEqual([
      ['我的模型服务', true],
      ['无密钥服务', false],
    ])
    // The second row is still listed even though it cannot answer yet.
    expect(second.config.id).toBeDefined()
  })
})

describe('setActiveProvider', () => {
  it('moves the claim and the settings value to the chosen provider', async () => {
    const first = await saveProvider(deps, validInput())
    const second = await saveProvider(deps, { ...validInput(), name: '备用服务' })

    const activated = await setActiveProvider(deps, { id: second.config.id })

    expect(activated.isActive).toBe(true)
    await expect(providers.findActive()).resolves.toMatchObject({ id: second.config.id })
    await expect(settings.read()).resolves.toMatchObject({ activeProviderId: second.config.id })
    await expect(providers.findById(first.config.id)).resolves.toMatchObject({ isActive: false })
  })

  it('refuses an unknown provider', async () => {
    await expect(setActiveProvider(deps, { id: 'missing' })).rejects.toSatisfy(
      (error: unknown) => {
        expectDomainCode(error, 'providerNotFound')
        return true
      },
    )
  })
})

describe('deleteProvider', () => {
  it('removes the row, the credential and the active setting', async () => {
    const saved = await saveProvider(deps, validInput())

    await deleteProvider(deps, { id: saved.config.id })

    await expect(providers.findById(saved.config.id)).resolves.toBeNull()
    await expect(secrets.load(saved.config.secretRef)).resolves.toBeNull()
    await expect(settings.read()).resolves.toMatchObject({ activeProviderId: null })
  })

  it('leaves the active setting alone when another provider is deleted', async () => {
    const first = await saveProvider(deps, validInput())
    const second = await saveProvider(deps, { ...validInput(), name: '备用服务' })

    await deleteProvider(deps, { id: second.config.id })

    await expect(settings.read()).resolves.toMatchObject({ activeProviderId: first.config.id })
  })

  it('refuses an unknown provider', async () => {
    await expect(deleteProvider(deps, { id: 'missing' })).rejects.toSatisfy(
      (error: unknown) => {
        expectDomainCode(error, 'providerNotFound')
        return true
      },
    )
  })
})

describe('testProviderConnection', () => {
  const factoryFor = (provider: ModelProvider): ProviderFactory => () => provider

  it('reports a successful probe with its latency', async () => {
    const saved = await saveProvider(deps, validInput())
    const result = await testProviderConnection(
      { ...deps, createProvider: factoryFor(successProvider()) },
      { id: saved.config.id },
    )

    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.detail).toBeUndefined()
  })

  it('refuses a provider without a stored credential', async () => {
    const saved = await saveProvider(deps, { ...validInput(), apiKey: undefined })
    await expect(
      testProviderConnection({ ...deps, createProvider: factoryFor(successProvider()) }, {
        id: saved.config.id,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectDomainCode(error, 'providerNotConfigured')
      return true
    })
  })

  it('reports a provider refusal as an unsuccessful probe', async () => {
    const saved = await saveProvider(deps, validInput())
    const refused: ModelProvider = {
      id: 'refused',
      modelId: 'm',
      supportsImages: false,
      stream() {
        throw new ModelCallError('服务返回 401：密钥无效', { retryable: false, status: 401 })
      },
    }
    const result = await testProviderConnection(
      { ...deps, createProvider: factoryFor(refused) },
      { id: saved.config.id },
    )

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('401')
  })

  it('reports an unknown provider and a fault as the contract states', async () => {
    await expect(
      testProviderConnection({ ...deps, createProvider: factoryFor(successProvider()) }, {
        id: 'missing',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectDomainCode(error, 'providerNotFound')
      return true
    })

    const saved = await saveProvider(deps, validInput())
    const broken: ModelProvider = {
      id: 'broken',
      modelId: 'm',
      supportsImages: false,
      stream() {
        throw new Error('适配器构造失败')
      },
    }
    await expect(
      testProviderConnection({ ...deps, createProvider: factoryFor(broken) }, {
        id: saved.config.id,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectDomainCode(error, 'modelCallFailed')
      return true
    })
  })
})

function successProvider(): ModelProvider {
  return new ScriptedModelProvider({
    script: [{ type: 'text', textDelta: 'pong' }],
  })
}

describe('the saved provider row', () => {
  it('round-trips through the repository without losing the flags', async () => {
    const saved = await saveProvider(deps, { ...validInput(), supportsImages: true })
    const row: ProviderConfig | null = await providers.findById(saved.config.id)

    expect(row).toMatchObject({ supportsImages: true, isActive: true })
    await expect(providers.listAll()).resolves.toHaveLength(1)
  })
})
