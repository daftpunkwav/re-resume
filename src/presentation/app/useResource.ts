/**
 * @file useResource
 * @description Loads one value from the application services and keeps it in
 * step with edits. Every list and detail region in the interface reads through
 * it, so loading, empty and failure states look the same everywhere and a
 * refresh is always one call away.
 */

import { useEffect, useState } from 'react'
import { describeError } from './errorMessages'
import type { ReadableError } from './errorMessages'

export interface Resource<T> {
  readonly data: T | null
  readonly loading: boolean
  readonly error: ReadableError | null
  reload(): Promise<void>
  /** Replaces the held value without a round trip, after an edit returns one. */
  set(data: T): void
}

interface ResourceState<T> {
  readonly data: T | null
  readonly error: ReadableError | null
  readonly loaded: boolean
}

export function useResource<T>(
  load: () => Promise<T>,
  dependencies: readonly unknown[],
): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    error: null,
    loaded: false,
  })

  useEffect(() => {
    let cancelled = false
    // Marking the load as pending is what stops the previous value from
    // standing on screen while a new one loads. The error goes with it:
    // `loading` is derived from it, so a failure left in place would show
    // the old message instead of the spinner for the whole retry.
    setState((previous) => ({ ...previous, error: null, loaded: false }))

    load()
      .then((next) => {
        if (!cancelled) setState({ data: next, error: null, loaded: true })
      })
      .catch((thrown: unknown) => {
        if (!cancelled) setState((previous) => ({ ...previous, error: describeError(thrown) }))
      })

    return () => {
      cancelled = true
    }
    // The dependency list is the caller's contract; `load` is rebuilt with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  const reload = async (): Promise<void> => {
    setState((previous) => ({ ...previous, error: null, loaded: false }))
    try {
      const next = await load()
      setState({ data: next, error: null, loaded: true })
    } catch (thrown) {
      setState((previous) => ({ ...previous, error: describeError(thrown) }))
    }
  }

  return {
    data: state.data,
    loading: !state.loaded && state.error === null,
    error: state.error,
    reload,
    set: (data: T) => setState({ data, error: null, loaded: true }),
  }
}
