/**
 * @file Result
 * @description Success-or-failure value used at boundaries that must report
 * failure instead of throwing: agent tool argument parsing and query ports
 * whose callers branch on the outcome.
 *
 * Responsibilities:
 * - Carry either a value or a structured failure, with no ambiguity
 * - Provide the two constructors and the two predicates
 *
 * Constraints:
 * - This module must not depend on UI-layer components.
 * - Aggregate invariants throw DomainError; Result is for callers that branch
 *   rather than propagate.
 */

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

/** The error type defaults to Error; callers that branch on a closed set of
 *  failures narrow it to that set at the signature. */
export type Result<T, E = Error> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok
}
