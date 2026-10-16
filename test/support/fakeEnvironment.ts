/**
 * @file fakeEnvironment
 * @description Deterministic replacements for the two ambient dependencies of
 * the domain: time and identifier allocation. Tests that use them produce the
 * same rows on every run.
 */

import { parseDateTime } from '../../src/domain/shared/DateTime'
import type { DateTime } from '../../src/domain/shared/DateTime'
import type { Clock } from '../../src/domain/catalog/ports/Clock'
import type { IdGenerator } from '../../src/domain/shared/IdGenerator'

const EPOCH: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

export class FixedClock implements Clock {
  #ticks = 0

  constructor(private readonly start: DateTime = EPOCH) {}

  now(): DateTime {
    this.#ticks += 1
    const next = new Date(this.start)
    next.setTime(new Date(this.start).getTime() + (this.#ticks - 1) * 1000)
    return next.toISOString() as DateTime
  }

  reset(): void {
    this.#ticks = 0
  }
}

/** Readable ids make mapper and repository failures legible in assertions. */
export class SequentialIdGenerator implements IdGenerator {
  #next = 1

  constructor(private readonly prefix = 'id') {}

  next(): string {
    const value = `${this.prefix}-${this.#next}`
    this.#next += 1
    return value
  }

  reset(): void {
    this.#next = 1
  }
}
