/**
 * @file providerStatus.test
 * @description The two states the sidebar and the top bar can describe today.
 */

import { describe, expect, it } from 'vitest'

import { describeProviderStatus } from '../../../src/presentation/app/providerStatus'

describe('describeProviderStatus', () => {
  it('describes a window with no model service', () => {
    const status = describeProviderStatus(null)

    expect(status.status).toBe('unconfigured')
    expect(status.label).toBe('模型服务未配置')
    expect(status.tone).toBe('neutral')
    expect(status.detail).toContain('模型服务')
  })

  it('describes a configured service whose connectivity is untested', () => {
    const status = describeProviderStatus('provider-1')

    expect(status.status).toBe('configured-untested')
    expect(status.tone).toBe('warning')
    expect(status.detail).toContain('provider-1')
    expect(status.detail).toContain('连通性')
  })
})
