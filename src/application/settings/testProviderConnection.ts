/**
 * @file testProviderConnection
 * @description Verifies one saved model service end to end: the address answers,
 * the key is accepted and the model name exists. The probe is deliberately the
 * smallest request the wire format allows, and it writes nothing.
 *
 * Responsibilities:
 * - Load the saved row and its credential and build a throwaway adapter
 * - Send one short request, stop at the first frame, and report the latency
 * - Turn a timeout or a provider refusal into a readable result instead of an
 *   exception, because the settings form renders it beside the test button
 *
 * Constraints:
 * - Three seconds cover the whole probe. A provider that accepts the request but
 *   never sends a frame is reported as unreachable, which is the same answer for
 *   the user as a refused connection.
 * - The result carries a diagnostic only; the credential is scrubbed out of any
 *   message that came back from the provider.
 * - The adapter factory is injected: the application layer never constructs a
 *   vendor adapter and never sees the HTTP client.
 */

import type {
  ModelProvider,
  ChatMessage,
  ModelChunk,
} from '../../domain/generation/ports/ModelProvider'
import { readModelCallFailure } from '../../domain/generation/ports/ModelProvider'
import type { ProviderConfig } from '../../domain/settings/ProviderConfig'
import { DomainError } from '../../domain/shared/DomainError'
import { redactSecret } from '../generation/redactSecret'
import {
  PROVIDER_CONNECTION_TIMEOUT_MS,
  PROVIDER_PROBE_MAX_OUTPUT_TOKENS,
  providerNotFound,
  providerNotConfigured,
} from './providerConfiguration'
import type { ProviderConfigurationDeps } from './providerConfiguration'

/** The request every probe sends; a ping has no conversation behind it. */
const PROBE_MESSAGES: readonly ChatMessage[] = [
  { role: 'user', parts: [{ kind: 'text', text: 'ping' }] },
]

export interface ProviderConnectionTestResult {
  readonly ok: boolean
  /** Milliseconds from handing the request to the adapter to the first answer. */
  readonly latencyMs: number
  /** Readable reason the test failed; absent when it succeeded. */
  readonly detail?: string
}

/** Builds the adapter for a saved row; the composition root supplies it. */
export type ProviderFactory = (config: ProviderConfig, apiKey: string) => ModelProvider

export interface TestProviderConnectionDeps extends ProviderConfigurationDeps {
  readonly createProvider: ProviderFactory
}

export interface TestProviderConnectionInput {
  readonly id: string
}

export async function testProviderConnection(
  deps: TestProviderConnectionDeps,
  input: TestProviderConnectionInput,
): Promise<ProviderConnectionTestResult> {
  const config = await deps.providers.findById(input.id)
  if (config === null) throw providerNotFound(input.id)
  const apiKey = await deps.secrets.load(config.secretRef)
  if (apiKey === null || apiKey === '') throw providerNotConfigured(input.id)
  const provider = deps.createProvider(config, apiKey)
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, PROVIDER_CONNECTION_TIMEOUT_MS)
  const startedAt = Date.parse(deps.clock.now())
  let timedOut = false
  let timeoutRejection: ReturnType<typeof setTimeout> | null = null
  let iterator: AsyncIterator<ModelChunk> | null = null
  try {
    const stream = provider.stream(
      {
        system: null,
        messages: PROBE_MESSAGES,
        maxOutputTokens: PROVIDER_PROBE_MAX_OUTPUT_TOKENS,
      },
      [],
      controller.signal,
    )
    iterator = stream[Symbol.asyncIterator]()
    // The signal is the cooperative path; the race is the guarantee. An adapter
    // that ignores the abort must not keep the settings form waiting forever.
    const first = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timeoutRejection = setTimeout(() => {
          controller.abort()
          reject(new Error(`${PROVIDER_CONNECTION_TIMEOUT_MS.toString()}ms timeout`))
        }, PROVIDER_CONNECTION_TIMEOUT_MS)
      }),
    ])
    const latencyMs = Math.max(0, Date.parse(deps.clock.now()) - startedAt)
    if (first.done === true) {
      return {
        ok: true,
        latencyMs,
        detail: '连接正常，但服务没有返回内容。',
      }
    }
    return { ok: true, latencyMs }
  } catch (failure) {
    timedOut = controller.signal.aborted
    const latencyMs = Math.max(0, Date.parse(deps.clock.now()) - startedAt)
    if (timedOut) {
      return {
        ok: false,
        latencyMs,
        detail: `连接超时：${(PROVIDER_CONNECTION_TIMEOUT_MS / 1000).toFixed(0)} 秒内没有收到响应。`,
      }
    }
    const classified = readModelCallFailure(failure)
    if (classified === null) {
      const reason = failure instanceof Error ? failure.message : String(failure)
      throw new DomainError('modelCallFailed', `连通性测试失败：${reason}`, {
        entity: 'providerConfig',
        id: config.id,
        blockers: [],
      })
    }
    return {
      ok: false,
      latencyMs,
      detail: redactSecret(classified.detail, [apiKey]),
    }
  } finally {
    clearTimeout(timer)
    if (timeoutRejection !== null) clearTimeout(timeoutRejection)
    // The probe stops at the first frame on purpose; releasing the connection is
    // the adapter's contract, and a provider that never sent one is already gone.
    if (iterator !== null && iterator.return !== undefined) {
      try {
        await iterator.return()
      } catch {
        // The connection is being abandoned after a deliberate stop; there is no
        // later step that could report a release failure to anyone.
      }
    }
  }
}
