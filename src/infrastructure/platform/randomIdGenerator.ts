/**
 * @file RandomIdGenerator
 * @description Identifier source for the composition root. Produces a version 4
 * UUID from the platform CSPRNG; the domain brands the returned string, so this
 * class only has to produce a value nothing else has produced.
 *
 * Constraints:
 * - Must not import a Node crypto polyfill: the browser build would carry it
 *   into the bundle, and the host runtime is the only place this runs.
 * - Must use crypto.getRandomValues, not crypto.randomUUID. The convenience
 *   method only landed in Safari 15.4 while the declared WebView baseline is
 *   Safari 15, so calling it would be a baseline violation on macOS 10.15 with
 *   Safari 15.0-15.3. getRandomValues predates every browser this app targets.
 */

import type { IdGenerator } from '../../domain/shared/IdGenerator'

const UUID_BYTES = 16

export class RandomIdGenerator implements IdGenerator {
  next(): string {
    const bytes = new Uint8Array(UUID_BYTES)
    crypto.getRandomValues(bytes)
    // Version 4 in the high nibble of byte 6, RFC 4122 variant in byte 8.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    return formatUuid(bytes)
  }
}

function formatUuid(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
