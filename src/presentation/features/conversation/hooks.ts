/**
 * @file hooks
 * @description The behaviour the conversation components share: an input that
 * grows with its text, a streamed answer sampled once per animation frame, a
 * transcript that follows the newest message, and the inline title editor used
 * by the header and the sidebar rows.
 *
 * Constraints:
 * - The frame sampler reads the store inside the frame callback: a burst of
 *   deltas causes one paint, not one render per token.
 * - A transcript only follows the newest message while the reader is already at
 *   the bottom; scrolling up to read is not fought by the next delta.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { useRunStore } from './stores/runStore'

/** Longest auto-grown input, in lines, before the textarea scrolls instead. */
export const COMPOSER_MAX_LINES = 8

/** Grows the textarea up to eight lines, then keeps the height and scrolls. */
export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
): void {
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    element.style.height = 'auto'
    const style = window.getComputedStyle(element)
    const lineHeight = Number.parseFloat(style.lineHeight)
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const maximum = (Number.isFinite(lineHeight) ? lineHeight : 22) * COMPOSER_MAX_LINES + padding
    element.style.height = `${Math.min(element.scrollHeight, maximum).toString()}px`
    element.style.overflowY = element.scrollHeight > maximum ? 'auto' : 'hidden'
  }, [ref, value])
}

/**
 * The streamed answer of the run in flight, sampled once per frame. The buffer
 * itself lives in the store; this hook only decides when React sees it.
 */
export function useStreamingText(): string {
  const [text, setText] = useState(() => useRunStore.getState().buffer)
  useEffect(() => {
    let frame: number | null = null
    let last = useRunStore.getState().buffer
    const unsubscribe = useRunStore.subscribe(() => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        const next = useRunStore.getState().buffer
        if (next === last) return
        last = next
        setText(next)
        for (const listener of streamPaintListeners) listener()
      })
    })
    return () => {
      unsubscribe()
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [])
  return text
}

/**
 * Called once per painted stream frame, after React committed it. The transcript
 * uses it to stay pinned to the bottom without subscribing to every delta.
 */
export function onStreamPaint(listener: () => void): () => void {
  streamPaintListeners.add(listener)
  return () => {
    streamPaintListeners.delete(listener)
  }
}

const streamPaintListeners = new Set<() => void>()

/** Moves the scroll position to the bottom of the region. */
export function scrollToBottom(container: HTMLElement, smooth: boolean): void {
  // A scroll call that cannot move the position still queues a scroll event, and
  // that event can arrive after the content grew past the viewport (an image
  // painting late): it would report distance > 0 and unstick the reader. Only
  // move when there is somewhere to move.
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight
  if (distance <= 0) return
  // jsdom has no layout engine and no scrollTo; assigning the position is the
  // same intent and keeps the component testable outside a real browser.
  if (typeof container.scrollTo !== 'function') {
    container.scrollTop = container.scrollHeight
    return
  }
  container.scrollTo({
    top: container.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  })
}

export interface StickToBottom {
  readonly containerRef: RefObject<HTMLDivElement | null>
  /** True while the reader is at (or near) the newest message. */
  readonly atBottom: boolean
  readonly jumpToBottom: () => void
  /** Re-pins the transcript after out-of-band content growth (an image load). */
  readonly followIfAtBottom: () => void
}

/**
 * Follows the newest message while the reader is at the bottom. `contentKey`
 * changes whenever new content was appended; the effect scrolls only when the
 * reader has not scrolled away.
 */
export function useStickToBottom(contentKey: number): StickToBottom {
  const containerRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const stick = useRef(true)
  // The last position this hook saw. Content growth can fire a scroll event
  // without moving the position; only a changed position means the reader
  // scrolled, and only that may unstick the transcript.
  const lastTop = useRef(0)

  const onScroll = useCallback(() => {
    const element = containerRef.current
    if (element === null) return
    if (element.scrollTop === lastTop.current) return
    lastTop.current = element.scrollTop
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    const next = distance < 48
    stick.current = next
    setAtBottom(next)
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (element === null) return
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [onScroll])

  useLayoutEffect(() => {
    const element = containerRef.current
    if (element === null || !stick.current) return
    scrollToBottom(element, false)
    lastTop.current = element.scrollTop
  }, [contentKey])

  const jumpToBottom = useCallback(() => {
    const element = containerRef.current
    if (element === null) return
    stick.current = true
    setAtBottom(true)
    scrollToBottom(element, true)
    window.setTimeout(() => {
      lastTop.current = element.scrollTop
    }, 0)
  }, [])

  const followIfAtBottom = useCallback(() => {
    const element = containerRef.current
    if (element === null || !stick.current) return
    scrollToBottom(element, false)
    lastTop.current = element.scrollTop
  }, [])

  return { containerRef, atBottom, jumpToBottom, followIfAtBottom }
}

export interface InlineRename {
  readonly editing: boolean
  readonly draft: string
  setDraft(value: string): void
  start(): void
  cancel(): void
  commit(): Promise<void>
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}

/**
 * The inline title editor: Enter commits, Escape restores, blur commits. An
 * empty or unchanged value closes the field without a write.
 */
export function useInlineRename(
  value: string,
  onCommit: (next: string) => Promise<boolean>,
): InlineRename {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const committing = useRef(false)

  const start = useCallback(() => {
    setDraft(value)
    setEditing(true)
  }, [value])

  const cancel = useCallback(() => {
    setDraft(value)
    setEditing(false)
  }, [value])

  const commit = useCallback(async () => {
    if (!editing || committing.current) return
    const next = draft.trim()
    if (next === '' || next === value) {
      setEditing(false)
      return
    }
    committing.current = true
    setEditing(false)
    try {
      await onCommit(next)
    } finally {
      committing.current = false
    }
  }, [draft, editing, onCommit, value])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void commit()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    },
    [cancel, commit],
  )

  return { editing, draft, setDraft, start, cancel, commit, onKeyDown }
}
