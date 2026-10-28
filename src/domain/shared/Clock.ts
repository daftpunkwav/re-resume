/**
 * @file Clock
 * @description Time source. Use cases take it as a parameter so every write
 * gets a timestamp the test can predict.
 *
 * Lives in shared/, beside IdGenerator, because time is a cross-cutting
 * primitive; its value type, DateTime, already lived here.
 */

import type { DateTime } from './DateTime'

export interface Clock {
  now(): DateTime
}
