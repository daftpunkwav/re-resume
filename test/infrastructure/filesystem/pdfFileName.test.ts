/**
 * @file pdfFileName.test
 * @description The shared file-name rules of both savers: forbidden characters
 * are replaced, a missing extension is added, trailing dots cannot break a
 * Windows write, and an empty suggestion still produces a usable name.
 */

import { describe, expect, it } from 'vitest'

import { sanitizePdfFileName } from '../../../src/infrastructure/filesystem/pdfFileName'

describe('sanitizePdfFileName', () => {
  it('replaces the characters a platform forbids', () => {
    expect(sanitizePdfFileName('a/b:c*d?"e<f>g|h.pdf')).toBe('a b c d e f g h.pdf')
  })

  it('adds the extension and removes a redundant one', () => {
    expect(sanitizePdfFileName('resume')).toBe('resume.pdf')
    expect(sanitizePdfFileName('resume.pdf')).toBe('resume.pdf')
    expect(sanitizePdfFileName('resume.PDF')).toBe('resume.pdf')
  })

  it('removes trailing dots and spaces a Windows write would strip', () => {
    expect(sanitizePdfFileName('resume. . ')).toBe('resume.pdf')
  })

  it('replaces control characters', () => {
    expect(sanitizePdfFileName('a\u0001b.pdf')).toBe('a b.pdf')
  })

  it('falls back to a generic stem when nothing usable remains', () => {
    expect(sanitizePdfFileName('///.pdf')).toBe('简历.pdf')
    expect(sanitizePdfFileName('')).toBe('简历.pdf')
  })

  it('bounds a long stem by code points', () => {
    const name = sanitizePdfFileName(`${'标'.repeat(120)}.pdf`)
    expect([...name.replace(/\.pdf$/u, '')]).toHaveLength(80)
  })
})
