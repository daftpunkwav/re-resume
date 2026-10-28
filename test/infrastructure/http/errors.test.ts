/**
 * @file errors.test
 * @description The provider failure taxonomy and the unconfigured provider:
 * which statuses are retryable, how retry-after is read, and that the missing
 * configuration fails once, permanently, with a readable reason.
 */

import { describe, expect, it } from 'vitest'

import {
  ERROR_BODY_CHAR_LIMIT,
  ModelCallError,
  isRetryableStatus,
  modelCallErrorForStatus,
  modelCallErrorForThrown,
  readRetryAfterSeconds,
  truncateDetail,
} from '../../../src/infrastructure/http/ProviderAdapters/errors'
import { inferImageSupport } from '../../../src/infrastructure/http/ProviderAdapters/imageSupport'
import {
  UNCONFIGURED_PROVIDER_MESSAGE,
  UnconfiguredModelProvider,
} from '../../../src/infrastructure/http/ProviderAdapters/UnconfiguredModelProvider'

describe('retry classification', () => {
  it('retries exactly 429, 500, 502, 503 and 504', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status), String(status)).toBe(true)
    }
    for (const status of [400, 401, 403, 404, 409, 422, 501, 505]) {
      expect(isRetryableStatus(status), String(status)).toBe(false)
    }
  })

  it('builds the error for a failed response', () => {
    const error = modelCallErrorForStatus('endpoint', 500, 'boom', null)
    expect(error).toBeInstanceOf(ModelCallError)
    expect(error).toMatchObject({ retryable: true, status: 500 })
    expect(error.message).toContain('500')
    expect(error.message).toContain('boom')
  })

  it('turns a 429 with a long retry-after into a user decision', () => {
    const shortWait = modelCallErrorForStatus('endpoint', 429, 'slow', 2)
    expect(shortWait.retryable).toBe(true)
    const longWait = modelCallErrorForStatus('endpoint', 429, 'slow', 30)
    expect(longWait.retryable).toBe(false)
    expect(longWait.message).toContain('30')
  })

  it('treats a transport throw as retryable and an abort as not', () => {
    const interrupted = modelCallErrorForThrown('endpoint', new Error('network down'))
    expect(interrupted).toMatchObject({ retryable: true, status: null })

    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(modelCallErrorForThrown('endpoint', abort).retryable).toBe(false)
  })

  it('reads retry-after as seconds or an HTTP date', () => {
    expect(readRetryAfterSeconds({ 'retry-after': '2' })).toBe(2)
    expect(readRetryAfterSeconds({})).toBeNull()
    expect(readRetryAfterSeconds({ 'retry-after': '2.5' })).toBeNull()
    const inTenSeconds = new Date(Date.now() + 10_000).toUTCString()
    const parsed = readRetryAfterSeconds({ 'retry-after': inTenSeconds })
    expect(parsed).not.toBeNull()
    expect(parsed ?? 0).toBeGreaterThan(0)
  })

  it('caps a diagnostic at the documented length', () => {
    expect([...truncateDetail('x'.repeat(2000))]).toHaveLength(ERROR_BODY_CHAR_LIMIT)
  })
})

describe('image-support inference', () => {
  it('treats Anthropic as image capable and filters the old OpenAI text models', () => {
    expect(inferImageSupport('anthropic', 'claude-sonnet')).toBe(true)
    expect(inferImageSupport('openai-compatible', 'gpt-4o')).toBe(true)
    expect(inferImageSupport('openai-compatible', 'gpt-3.5-turbo')).toBe(false)
    expect(inferImageSupport('openai-compatible', 'text-embedding-3')).toBe(false)
    expect(inferImageSupport('openai-compatible', 'o1-mini')).toBe(false)
  })
})

describe('UnconfiguredModelProvider', () => {
  it('fails a request once with a non-retryable configuration message', async () => {
    const provider = new UnconfiguredModelProvider()
    expect(provider.supportsImages).toBe(false)
    const stream = provider.stream(
      { system: null, messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hi' }] }] },
      [],
    )
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      name: 'ModelCallError',
      retryable: false,
    })
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow(
      UNCONFIGURED_PROVIDER_MESSAGE,
    )
  })
})
