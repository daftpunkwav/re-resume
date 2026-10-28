/**
 * @file imageThumbnail.test
 * @description The attachment thumbnail path in a real browser: a large image
 * decodes to the bounded display size, and bytes the platform cannot decode fall
 * back to the original object URL instead of losing the preview.
 */

import { describe, expect, it } from 'vitest'

import {
  THUMBNAIL_MAX_EDGE,
  createThumbnailUrl,
  revokePreviewUrl,
} from '../../src/presentation/features/conversation/attachments/attachmentFormat'

async function pngBytes(width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2d context is unavailable')
  context.fillStyle = '#3366ff'
  context.fillRect(0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (blob === null) throw new Error('the canvas did not encode')
  return new Uint8Array(await blob.arrayBuffer())
}

async function decodedSize(url: string): Promise<{ width: number; height: number }> {
  const image = new Image()
  image.src = url
  await image.decode()
  return { width: image.naturalWidth, height: image.naturalHeight }
}

describe('the attachment thumbnail', () => {
  it('decodes a large image at the bounded edge', async () => {
    const bytes = await pngBytes(1000, 800)
    const url = await createThumbnailUrl(bytes, 'image/png')
    expect(url).not.toBeNull()
    const size = await decodedSize(url as string)
    expect(Math.max(size.width, size.height)).toBe(THUMBNAIL_MAX_EDGE)
    expect(size.width).toBe(320)
    expect(size.height).toBe(256)
    revokePreviewUrl(url)
  })

  it('falls back to the original bytes when the image cannot be decoded', async () => {
    const url = await createThumbnailUrl(new Uint8Array([1, 2, 3, 4]), 'image/png')
    expect(url).not.toBeNull()
    revokePreviewUrl(url)
  })
})
