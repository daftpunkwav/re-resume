/**
 * @file providerStatus
 * @description The one-line model-service state the sidebar shows. Only two
 * states can be read from stored data: nothing chosen, or an active provider
 * whose connectivity is a property of the current process and therefore not
 * persisted. The model picker reads the full provider list and the last probe
 * result; this helper stays the compact summary beside the settings entry.
 */

export type ProviderStatus = 'unconfigured' | 'configured-untested'

export interface ProviderStatusDescription {
  readonly status: ProviderStatus
  readonly label: string
  readonly detail: string
  readonly tone: 'neutral' | 'warning'
}

export function describeProviderStatus(activeProviderId: string | null): ProviderStatusDescription {
  if (activeProviderId === null) {
    return {
      status: 'unconfigured',
      label: '模型服务未配置',
      detail: '简历助手需要一个模型服务。配置项在设置的「模型服务」分节。',
      tone: 'neutral',
    }
  }
  return {
    status: 'configured-untested',
    label: '模型服务已配置',
    detail: `当前模型服务：${activeProviderId}。连通性尚未测试。`,
    tone: 'warning',
  }
}
