/**
 * @file Clock
 * @description Time source. Use cases take it as a parameter so every write
 * gets a timestamp the test can predict.
 *
 * Lives in shared/, beside IdGenerator, because time is a cross-cutting
 * primitive rather than a catalog concept — its value type, DateTime, already
 * was.
 */

import type { DateTime } from './DateTime'

export interface Clock {
  now(): DateTime
}
