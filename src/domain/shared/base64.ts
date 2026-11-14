/**
 * @file base64
 * @description Base64 over plain bytes without Node or plugin helpers: the
 * encoding itself comes from the runtime (`btoa`/`atob`), and the bytes are
 * fed in chunks so a large attachment cannot blow the argument limit of
 * `String.fromCharCode` in one call.
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 */

/** Bytes per `String.fromCharCode` call; the engine's spread-argument ceiling. */
const CHUNK = 0x8000

/** Base64 of a byte array. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

/** The bytes a base64 string names. Invalid input throws from `atob`. */
export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
