/**
 * @file TextEditorOverlay
 * @description The in-place text editor drawn over one canvas block. It is a
 * real textarea, positioned and styled with the block's own font, zoom and
 * line height, so composing Chinese with an IME shows the same size and line
 * breaks as the paper below it.
 *
 * Responsibilities:
 * - Match the edited block's box and text style at the current zoom
 * - Keep IME composition from being mistaken for input shortcuts
 * - Escape cancels (including the 100ms window after composition ends),
 *   blur commits, empty text deletes the override it edits
 *
 * Constraints:
 * - The overlay never writes: it calls `onCommit` and lets the studio route the
 *   text through the use cases.
 * - Escape during composition is left to the IME; cancelling then would drop
 *   the candidate list under the user's hands.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { cssFamilyName } from '../../domain/resume/TextStyle'
import type { TextStyle } from '../../domain/resume/TextStyle'

export interface TextEditorOverlayProps {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly zoom: number
  readonly text: string
  readonly style: TextStyle
  readonly label: string
  readonly placeholder: string
  /** Set when the target cannot be emptied; null when empty means delete. */
  readonly emptyError: string | null
  readonly multiline: boolean
  readonly onCommit: (text: string) => Promise<boolean>
  readonly onCancel: () => void
}

export function TextEditorOverlay({
  left,
  top,
  width,
  height,
  zoom,
  text,
  style,
  label,
  placeholder,
  emptyError,
  multiline,
  onCommit,
  onCancel,
}: TextEditorOverlayProps) {
  const [value, setValue] = useState(text)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const composing = useRef(false)
  const cancelled = useRef(false)
  const committed = useRef(false)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const element = textarea.current
    if (element === null) return
    element.focus()
    // Editing an existing rewrite should not select-all: the caret belongs at
    // the end, the way continuing a sentence feels.
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  const commit = async (): Promise<void> => {
    if (cancelled.current || committed.current) return
    if (emptyError !== null && value.trim() === '') {
      setError(emptyError)
      return
    }
    committed.current = true
    setSaving(true)
    setError(null)
    const accepted = await onCommit(value)
    if (!accepted) {
      committed.current = false
      setSaving(false)
      setError('这次修改没有保存，请重试。')
    }
  }

  const cancel = (): void => {
    if (cancelled.current) return
    cancelled.current = true
    onCancel()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      // While a composition is open the key belongs to the IME. Once it has
      // ended, even the same physical Escape (which browsers may deliver after
      // compositionend with isComposing already false) cancels the overlay.
      if (composing.current) return
      event.preventDefault()
      cancel()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void commit()
    }
  }

  return (
    <div
      className="text-editor-overlay"
      style={{
        left: `${left.toString()}px`,
        top: `${top.toString()}px`,
        width: `${Math.max(width, 60).toString()}px`,
        minHeight: `${Math.max(height, 22).toString()}px`,
      }}
    >
      <textarea
        ref={textarea}
        className="text-editor-textarea"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        rows={multiline ? 4 : 1}
        spellCheck={false}
        style={{
          fontFamily: `${cssFamilyName(style.fontFamily)}, "Microsoft YaHei", "PingFang SC", sans-serif`,
          fontSize: `${(style.fontSize * zoom).toString()}px`,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          minHeight: `${Math.max(height, 22).toString()}px`,
        }}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          void commit()
        }}
      />
      <span className="text-editor-hint" role="note">
        {saving ? '保存中…' : 'Esc 取消 · 失焦或 ⌘/Ctrl+Enter 保存'}
      </span>
      {error === null ? null : (
        <span className="text-editor-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
