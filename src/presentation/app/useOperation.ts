/**
 * @file useOperation
 * @description Runs one asynchronous use case and tracks its state: idle,
 * busy or failed. Failures become a readable message rather than an
 * unhandled rejection, so every action in the interface reports back.
 */

import { useCallback, useState } from 'react'
import { describeError } from './errorMessages'
import type { ReadableError } from './errorMessages'

export interface OperationState {
  readonly busy: boolean
  readonly error: ReadableError | null
  run(): Promise<void>
  clearError(): void
}

export function useOperation(
  action: () => Promise<unknown>,
  onSettled?: () => void | Promise<void>,
): OperationState {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReadableError | null>(null)

  const run = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (onSettled !== undefined) await onSettled()
    } catch (thrown) {
      setError(describeError(thrown))
    } finally {
      setBusy(false)
    }
  }, [action, onSettled])

  const clearError = useCallback(() => setError(null), [])

  return { busy, error, run, clearError }
}
