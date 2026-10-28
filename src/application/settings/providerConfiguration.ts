/**
 * @file providerConfiguration
 * @description The dependencies and shared validation of the model-service use
 * cases. A provider is an endpoint plus a model name; its credential lives in
 * the secure store and the database row only names that reference.
 *
 * Responsibilities:
 * - Declare the ports and ambient sources the provider use cases receive
 * - Validate the endpoint, name and model name at the trust boundary
 * - Expose the derived status the interface renders for a provider
 *
 * Constraints:
 * - Only ports and Clock/IdGenerator appear in the dependency record: the use
 *   cases cannot construct an adapter or reach the network themselves.
 * - The API key never leaves this layer except into the SecretStore (on save)
 *   or the injected adapter factory (on a connection test).
 */

import { DomainError } from '../../domain/shared/DomainError'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { SecretStore } from '../../domain/generation/ports/SecretStore'
import { isProviderKind } from '../../domain/settings/ProviderConfig'
import type { ProviderConfig, ProviderKind } from '../../domain/settings/ProviderConfig'
import type { AppSettingsRepository } from '../../domain/settings/ports/AppSettingsRepository'
import type { ProviderConfigRepository } from '../../domain/settings/ports/ProviderConfigRepository'

/** Longest accepted display name of a provider, in code points. */
export const PROVIDER_NAME_MAX_LENGTH = 40

/** Longest accepted model name, in code points. */
export const PROVIDER_MODEL_ID_MAX_LENGTH = 120

/** Longest accepted endpoint, in code points. */
export const PROVIDER_BASE_URL_MAX_LENGTH = 500

/** The whole connection test must settle inside this budget. */
export const PROVIDER_CONNECTION_TIMEOUT_MS = 3000

/** Output ceiling of the probe request; the test verifies reachability, not quality. */
export const PROVIDER_PROBE_MAX_OUTPUT_TOKENS = 8

/** Hosts that may be reached over plain HTTP because they never leave the machine. */
const LOCAL_HTTP_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

export interface ProviderConfigurationDeps {
  readonly providers: ProviderConfigRepository
  readonly settings: AppSettingsRepository
  readonly secrets: SecretStore
  readonly clock: Clock
  readonly ids: IdGenerator
}

/** One row of the provider list the interface shows. */
export interface ProviderListItem {
  readonly config: ProviderConfig
  /** True when the secure store holds a credential for this provider. */
  readonly hasCredential: boolean
}

export interface ListProvidersOutput {
  readonly providers: readonly ProviderListItem[]
  readonly activeProviderId: string | null
}

/**
 * The saved configuration: the row plus the two facts the interface needs to
 * label it — whether a credential is stored and whether it serves requests.
 */
export interface SavedProvider {
  readonly config: ProviderConfig
  readonly hasCredential: boolean
}

function invalidSettings(message: string): DomainError {
  return new DomainError('invalidSettings', message, {
    entity: 'providerConfig',
    id: '',
    blockers: [],
  })
}

function fieldTooLong(field: string, maximum: number): DomainError {
  return new DomainError('fieldTooLong', `${field}不能超过 ${maximum.toString()} 个字符。`, {
    entity: 'providerConfig',
    id: field,
    blockers: [field],
  })
}

function codePointLength(text: string): number {
  return [...text].length
}

/** Validates the display name and returns it without surrounding whitespace. */
export function normaliseProviderName(raw: string): string {
  const name = raw.trim()
  if (name === '') {
    throw new DomainError('blankRequiredField', '模型服务名称不能为空。', {
      entity: 'providerConfig',
      id: 'name',
      blockers: ['name'],
    })
  }
  if (codePointLength(name) > PROVIDER_NAME_MAX_LENGTH) {
    throw fieldTooLong('模型服务名称', PROVIDER_NAME_MAX_LENGTH)
  }
  return name
}

/** Validates the model name and returns it without surrounding whitespace. */
export function normaliseModelId(raw: string): string {
  const modelId = raw.trim()
  if (modelId === '') {
    throw new DomainError('blankRequiredField', '模型名称不能为空。', {
      entity: 'providerConfig',
      id: 'modelId',
      blockers: ['modelId'],
    })
  }
  if (codePointLength(modelId) > PROVIDER_MODEL_ID_MAX_LENGTH) {
    throw fieldTooLong('模型名称', PROVIDER_MODEL_ID_MAX_LENGTH)
  }
  return modelId
}

/**
 * Validates the endpoint. An API address either travels encrypted or names the
 * machine the window runs on; anything else could leak the credential in
 * cleartext, and an address carrying its own credentials would duplicate the
 * one stored in the secure store.
 */
export function normaliseBaseUrl(raw: string): string {
  const baseUrl = raw.trim()
  if (baseUrl === '') {
    throw new DomainError('blankRequiredField', 'API 地址不能为空。', {
      entity: 'providerConfig',
      id: 'baseUrl',
      blockers: ['baseUrl'],
    })
  }
  if (codePointLength(baseUrl) > PROVIDER_BASE_URL_MAX_LENGTH) {
    throw fieldTooLong('API 地址', PROVIDER_BASE_URL_MAX_LENGTH)
  }
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw invalidSettings('API 地址不是合法的 URL。')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw invalidSettings('API 地址不能包含用户名或密码，密钥应单独填写。')
  }
  const localHttp = parsed.protocol === 'http:' && LOCAL_HTTP_HOSTS.includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw invalidSettings('API 地址必须以 https:// 开头（本机的 localhost 可以使用 http://）。')
  }
  return baseUrl
}

export function requireProviderKind(value: unknown): ProviderKind {
  if (!isProviderKind(value)) {
    throw invalidSettings('模型服务类型不是本版本支持的取值。')
  }
  return value
}

export function providerNotFound(id: string): DomainError {
  return new DomainError('providerNotFound', '找不到这个模型服务配置。', {
    entity: 'providerConfig',
    id,
    blockers: [id],
  })
}

export function providerNotConfigured(id: string): DomainError {
  return new DomainError('providerNotConfigured', '这个模型服务还没有保存 API Key。', {
    entity: 'providerConfig',
    id,
    blockers: [id],
  })
}

/** The credential value a saved row names, or null when none is stored yet. */
export async function readProviderCredential(
  deps: Pick<ProviderConfigurationDeps, 'secrets'>,
  config: ProviderConfig,
): Promise<string | null> {
  const secret = await deps.secrets.load(config.secretRef)
  return secret === null || secret === '' ? null : secret
}
