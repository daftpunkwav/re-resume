/**
 * @file domainErrors
 * @description Assertion helpers for the closed error contract: a refusal is
 * identified by its code, not by message text.
 */

import { expect } from 'vitest'

import { isDomainError } from '../../src/domain/shared/DomainError'
import type { DomainError } from '../../src/domain/shared/DomainError'

/** Asserts that the call throws a DomainError with the given code. */
export function expectDomainError(run: () => unknown, code: string): DomainError {
  try {
    run()
  } catch (error) {
    expect(isDomainError(error), `expected a DomainError, received ${describe(error)}`).toBe(true)
    if (!isDomainError(error)) throw error
    expect(error.code).toBe(code)
    return error
  }
  throw new Error(`Expected a DomainError with code "${code}", but nothing was thrown.`)
}

/** Asserts that the promise rejects with a DomainError carrying the given code. */
export async function expectDomainErrorAsync(
  promise: Promise<unknown>,
  code: string,
): Promise<DomainError> {
  try {
    await promise
  } catch (error) {
    expect(isDomainError(error), `expected a DomainError, received ${describe(error)}`).toBe(true)
    if (!isDomainError(error)) throw error
    expect(error.code).toBe(code)
    return error
  }
  throw new Error(`Expected a DomainError with code "${code}", but the promise resolved.`)
}

function describe(value: unknown): string {
  return value instanceof Error ? `${value.name}: ${value.message}` : String(value)
}
