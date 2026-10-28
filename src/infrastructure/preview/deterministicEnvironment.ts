/**
 * @file deterministicEnvironment
 * @description Time and identifier allocation for the preview assembly. A
 * preview session has to produce the same rows on every run, so the clock
 * starts at a fixed instant and identifiers count up.
 *
 * Constraints:
 * - Preview assembly only. Production uses the native clock and random ids.
 */

import { parseDateTime } from '../../domain/shared/DateTime'
import type { DateTime } from '../../domain/shared/DateTime'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'

/** Fixed instant the preview session starts from. */
export const PREVIEW_EPOCH: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

/** Advances one second per read, so timestamps are ordered and repeatable. */
export class FakeClock implements Clock {
  #ticks = 0

  constructor(private readonly start: DateTime = PREVIEW_EPOCH) {}

  now(): DateTime {
    this.#ticks += 1
    const next = new Date(this.start)
    next.setTime(new Date(this.start).getTime() + (this.#ticks - 1) * 1000)
    return next.toISOString() as DateTime
  }
}

/** Readable ids keep preview rows legible in the interface and in tests. */
export class SequentialIdGenerator implements IdGenerator {
  #next = 1

  constructor(private readonly prefix = 'id') {}

  next(): string {
    const value = `${this.prefix}-${this.#next}`
    this.#next += 1
    return value
  }
}
