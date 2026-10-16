/**
 * @file useResource
 * @description Loads one value from the application services and keeps it in
 * step with edits. Every list and detail region in the interface reads through
 * it, so loading, empty and failure states look the same everywhere and a
 * refresh is always one call away.
 */

import { useEffect, useRef, useState } from 'react'
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
  /**
   * A reload started by the caller and the load the dependency effect started
   * are two requests the component has no way to cancel, and either can settle
   * after the other. Numbering them means only the newest one may write, so a
   * slow response cannot replace a value the user has already moved past.
   */
  const newest = useRef(0)

  useEffect(() => {
    const request = newest.current + 1
    newest.current = request
    // Marking the load as pending is what stops the previous value from
    // standing on screen while a new one loads. The error goes with it:
    // `loading` is derived from it, so a failure left in place would show
    // the old message instead of the spinner for the whole retry.
    setState((previous) => ({ ...previous, error: null, loaded: false }))

    load()
      .then((next) => {
        if (newest.current === request) setState({ data: next, error: null, loaded: true })
      })
      .catch((thrown: unknown) => {
        if (newest.current === request) {
          setState((previous) => ({ ...previous, error: describeError(thrown) }))
        }
      })

    return () => {
      // Settling after the panel is gone must not write. Bumping only when this
      // request is still the newest leaves a request that has already been
      // superseded alone.
      if (newest.current === request) newest.current += 1
    }
    // The dependency list is the caller's contract; `load` is rebuilt with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  const reload = async (): Promise<void> => {
    const request = newest.current + 1
    newest.current = request
    setState((previous) => ({ ...previous, error: null, loaded: false }))
    try {
      const next = await load()
      if (newest.current === request) setState({ data: next, error: null, loaded: true })
    } catch (thrown) {
      if (newest.current === request) {
        setState((previous) => ({ ...previous, error: describeError(thrown) }))
      }
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
