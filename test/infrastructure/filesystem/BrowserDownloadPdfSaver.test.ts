/**
 * @file BrowserDownloadPdfSaver.test
 * @description The browser save path of the preview: no native dialog exists,
 * so the bytes are handed to the download list under the sanitized name and the
 * object URL is released afterwards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserDownloadPdfSaver } from '../../../src/infrastructure/filesystem/BrowserDownloadPdfSaver'

interface UrlShim {
  createObjectURL?: (blob: Blob) => string
  revokeObjectURL?: (url: string) => void
}

const url = URL as unknown as UrlShim

let clickSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  url.createObjectURL = vi.fn(() => 'blob:pdf')
  url.revokeObjectURL = vi.fn()
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete url.createObjectURL
  delete url.revokeObjectURL
})

describe('BrowserDownloadPdfSaver', () => {
  it('downloads under the sanitized name and returns it', async () => {
    vi.useFakeTimers()
    try {
      const written = await new BrowserDownloadPdfSaver().save(
        new Uint8Array([1, 2, 3]),
        'a/b.pdf',
      )

      expect(written).toBe('a b.pdf')
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(url.createObjectURL).toHaveBeenCalledTimes(1)
      // The release is deferred one task so a slow browser can start the read.
      expect(url.revokeObjectURL).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:pdf')
    } finally {
      vi.useRealTimers()
    }
  })
})
