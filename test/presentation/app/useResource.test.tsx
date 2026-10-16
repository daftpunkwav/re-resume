/**
 * @file useResource.test
 * @description The loading and failure states every region shares. The case
 * that matters is the retry: after a failure the region must show that the
 * next attempt is under way, not the error it already reported.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useResource } from '../../../src/presentation/app/useResource'

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: settle }
}

describe('useResource', () => {
  it('shows the loading state again when a reload starts', async () => {
    const retry = deferred<string[]>()
    let attempt = 0
    const load = (): Promise<string[]> => {
      attempt += 1
      return attempt === 1 ? Promise.reject(new Error('读不到')) : retry.promise
    }

    const { result } = renderHook(() => useResource(load, []))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.loading).toBe(false)

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.reload()
    })

    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()

    await act(async () => {
      retry.resolve(['后端简历'])
      await pending
    })
    expect(result.current.data).toEqual(['后端简历'])
  })

  it('lets the newest load win when two are in flight at once', async () => {
    const slow = deferred<string[]>()
    const fast = deferred<string[]>()
    let call = 0
    const load = (): Promise<string[]> => {
      call += 1
      return call === 1 ? slow.promise : fast.promise
    }

    const { result } = renderHook(() => useResource(load, []))

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.reload()
    })
    act(() => {
      pending = result.current.reload()
    })

    // The first reload answers last. It still holds the answer to a question
    // the region has already moved on from.
    await act(async () => {
      fast.resolve(['新的一份'])
      await pending
    })
    expect(result.current.data).toEqual(['新的一份'])

    await act(async () => {
      slow.resolve(['旧的一份'])
    })
    expect(result.current.data).toEqual(['新的一份'])
  })

  it('shows the loading state again when a dependency changes after a failure', async () => {
    const retry = deferred<string[]>()
    const load = (attempt: number): (() => Promise<string[]>) => () =>
      attempt === 1 ? Promise.reject(new Error('读不到')) : retry.promise

    const { result, rerender } = renderHook(
      ({ resumeId }: { readonly resumeId: string }) =>
        useResource(load(resumeId === 'draft' ? 1 : 2), [resumeId]),
      { initialProps: { resumeId: 'draft' } },
    )
    await waitFor(() => expect(result.current.error).not.toBeNull())

    rerender({ resumeId: 'frozen' })

    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()

    await act(async () => {
      retry.resolve(['全栈简历'])
    })
    expect(result.current.data).toEqual(['全栈简历'])
  })
})
