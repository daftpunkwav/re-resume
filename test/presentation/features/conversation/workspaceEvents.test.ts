/**
 * @file workspaceEvents.test
 * @description The one-way bus: a published signal reaches every live listener,
 * an unsubscribed listener stops receiving, and one listener that throws cannot
 * stop the others.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  publishWorkspaceSignal,
  resetWorkspaceSignals,
  subscribeWorkspaceSignals,
} from '../../../../src/presentation/features/conversation/workspaceEvents'
import type { AgentEvent } from '../../../../src/domain/generation/AgentEvent'

const EVENT: AgentEvent = {
  type: 'error',
  message: 'provider unreachable',
  retryable: true,
}

afterEach(() => {
  resetWorkspaceSignals()
})

describe('workspace signals', () => {
  it('delivers an event to every listener', () => {
    const first = vi.fn()
    const second = vi.fn()
    subscribeWorkspaceSignals(first)
    subscribeWorkspaceSignals(second)

    publishWorkspaceSignal({ kind: 'agentEvent', event: EVENT })

    expect(first).toHaveBeenCalledWith({ kind: 'agentEvent', event: EVENT })
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('stops delivery after the removal runs', () => {
    const listener = vi.fn()
    const remove = subscribeWorkspaceSignals(listener)
    remove()

    publishWorkspaceSignal({ kind: 'changesUndone', scope: 'library' })

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps delivering when one listener throws', () => {
    const broken = vi.fn(() => {
      throw new Error('panel failed')
    })
    const healthy = vi.fn()
    subscribeWorkspaceSignals(broken)
    subscribeWorkspaceSignals(healthy)

    publishWorkspaceSignal({ kind: 'changesUndone', scope: 'resume' })

    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
