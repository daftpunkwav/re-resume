/**
 * @file useAttachmentImageUrl
 * @description The object URL one image needs to paint: the picked file while it
 * is still in the composer, otherwise the bytes read back through the
 * conversation capability.
 *
 * Responsibilities:
 * - Create the URL and revoke it when the element goes away or the attachment
 *   changes
 * - Report loading and failure instead of rendering a broken image silently
 *
 * Constraints:
 * - No bytes are cached here: a thumbnail read is bounded by what is on screen,
 *   and revocation returns the memory when the message scrolls out of the DOM.
 * - The platform may not support object URLs (the jsdom test environment); the
 *   hook then reports `unavailable` and the caller renders a text fallback.
 * - The effect only sets state from the asynchronous read; the loading state is
 *   derived, so a render never schedules another one.
 */

import { useEffect, useState } from 'react'
import type { Attachment } from '../../../../domain/conversation/Attachment'
import { useServices } from '../../../app/ApplicationServicesProvider'
import { createPreviewUrl, filePreviewUrl, revokePreviewUrl } from './attachmentFormat'

export type AttachmentImageState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'failed' }
  | { readonly kind: 'unavailable' }

interface LoadedImage {
  readonly id: string
  readonly state: AttachmentImageState
}

/** Loads the preview URL of an attachment, preferring the still-open draft file. */
export function useAttachmentImageUrl(
  attachment: Attachment | null,
  file?: File | null,
): AttachmentImageState {
  const services = useServices()
  const [loaded, setLoaded] = useState<LoadedImage | null>(null)

  const fileUrl = file === undefined || file === null ? null : filePreviewUrl(file)

  useEffect(() => {
    if (attachment === null || (file !== undefined && file !== null)) return
    let cancelled = false
    let url: string | null = null
    void services.conversation
      .readAttachmentBytes(attachment.id)
      .then((bytes) => {
        if (cancelled) return
        url = createPreviewUrl(bytes, attachment.mimeType)
        setLoaded({
          id: attachment.id,
          state: url === null ? { kind: 'unavailable' } : { kind: 'ready', url },
        })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: attachment.id, state: { kind: 'failed' } })
      })
    return () => {
      cancelled = true
      revokePreviewUrl(url)
    }
  }, [attachment, file, services])

  if (attachment === null) return { kind: 'idle' }
  if (file !== undefined && file !== null) {
    return fileUrl === null ? { kind: 'unavailable' } : { kind: 'ready', url: fileUrl }
  }
  if (loaded !== null && loaded.id === attachment.id) return loaded.state
  return { kind: 'loading' }
}
