/**
 * @file SystemClock
 * @description Wall-clock time for the composition root. Every use case and
 * repository receives this one instance, so a single run's rows agree on when
 * they happened.
 *
 * Responsibilities:
 * - Read the host clock and brand the result as DateTime
 *
 * Constraints:
 * - The brand is obtained through parseDateTime, never through a cast, so a
 *   value that is not an ISO timestamp never reaches the domain.
 * - Must not cache the reading: two writes a microsecond apart are two events.
 */

import type { Clock } from '../../domain/catalog/ports/Clock'
import type { DateTime } from '../../domain/shared/DateTime'
import { parseDateTime } from '../../domain/shared/DateTime'

export class SystemClock implements Clock {
  now(): DateTime {
    const now = parseDateTime(new Date().toISOString())
    if (now === null) {
      throw new Error('Reading the system clock produced a timestamp parseDateTime rejected.')
    }
    return now
  }
}
