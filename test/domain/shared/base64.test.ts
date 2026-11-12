/**
 * @file base64.test
 * @description The pure codec every byte payload crosses: round trips hold,
 * and the chunked encoding matches the one-shot encoding the runtime offers
 * for small inputs.
 */

import { describe, expect, it } from 'vitest'

import { base64ToBytes, toBase64 } from '../../../src/domain/shared/base64'

describe('base64', () => {
  it('round-trips empty and small byte arrays', () => {
    expect(toBase64(new Uint8Array(0))).toBe('')
    expect(base64ToBytes('')).toEqual(new Uint8Array(0))
    expect(base64ToBytes(toBase64(new Uint8Array([1, 2, 3])))).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('matches the per-byte encoding across a chunk boundary and beyond', () => {
    // 0x8000 is the chunk size: a straddle and a multi-chunk array prove the
    // loop reassembles exactly what byte-at-a-time joining would.
    const sizes = [0x7fff, 0x8000, 0x8001, 0x20000]
    for (const size of sizes) {
      const bytes = new Uint8Array(size)
      for (let index = 0; index < size; index += 1) bytes[index] = index % 251
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      expect(toBase64(bytes)).toBe(btoa(binary))
    }
  })

  it('refuses text that is not base64', () => {
    expect(() => base64ToBytes('not base64!')).toThrow()
  })
})
