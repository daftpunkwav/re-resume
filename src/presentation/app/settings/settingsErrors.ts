/**
 * @file settingsErrors
 * @description One way for the settings surface to turn a refusal into words: a
 * domain refusal carries the specific reason (which field, which row, which
 * version), and everything else falls back to the shared error map.
 */

import { DomainError } from '../../../domain/shared/DomainError'
import { describeError } from '../errorMessages'

export function messageOf(error: unknown): string {
  return error instanceof DomainError ? error.message : describeError(error).message
}
