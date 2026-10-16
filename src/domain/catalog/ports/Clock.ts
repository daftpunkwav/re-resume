/**
 * @file Clock
 * @description Time source. Use cases take it as a parameter so every write
 * gets a timestamp the test can predict.
 */

import type { DateTime } from '../../shared/DateTime'

export interface Clock {
  now(): DateTime
}
