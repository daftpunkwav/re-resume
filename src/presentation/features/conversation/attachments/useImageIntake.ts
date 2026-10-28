/**
 * @file useImageIntake
 * @description The three ways an image enters the composer: paste, choose a
 * file, drag and drop. The hook owns only the DOM wiring and the drag state;
 * validating and storing the files belongs to the conversation store.
 *
 * Responsibilities:
 * - Turn a paste event that carries images into a file list, leaving a text
 *   paste untouched
 * - Open the caller's file input and report the chosen images
 * - Track a drag hover so the drop target can show it is ready
 *
 * Constraints:
 * - WebView2 delivers a clipboard screenshot as a `File` in `clipboardData`;
 *   WKWebView may deliver it as an item instead. Both paths are read, and the
 *   platform without either still has the picker and the drop target.
 * - A drag leaves the window through child elements, so enter/leave are counted
 *   rather than toggled by the first event.
 * - The input ref belongs to the component: the hook returns no refs, so it can
 *   be destructured during render without reading a ref there.
 */

import { useRef, useState } from 'react'
import type { DragEvent, ClipboardEvent, RefObject } from 'react'
import { imageFilesFromClipboard, imageFilesFromDataTransfer } from './attachmentFormat'

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

/** Whether a drag carries files. `types` is a DOMStringList on older WebViews. */
function hasFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files')
}

export interface ImageIntake {
  /** True while a drag is over the drop target. */
  readonly dragging: boolean
  openPicker(): void
  onPaste(event: ClipboardEvent<HTMLElement>): void
  onDragEnter(event: DragEvent<HTMLElement>): void
  onDragOver(event: DragEvent<HTMLElement>): void
  onDragLeave(event: DragEvent<HTMLElement>): void
  onDrop(event: DragEvent<HTMLElement>): void
}

/**
 * @param onFiles Receives the images; the caller validates and stores them.
 * @param disabled While true, drops and pasted files are ignored (a run owns
 *   the composer, or nothing is mounted to receive them).
 * @param fileInputRef The caller's hidden picker, opened by `openPicker`.
 */
export function useImageIntake(
  onFiles: (files: readonly File[]) => void,
  disabled: boolean,
  fileInputRef: RefObject<HTMLInputElement | null>,
): ImageIntake {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  return {
    dragging,
    openPicker() {
      if (disabled) return
      fileInputRef.current?.click()
    },
    onPaste(event) {
      if (disabled) return
      const files = imageFilesFromClipboard(event.clipboardData)
      if (files.length === 0) return
      // A screenshot should not also paste its placeholder text or file name.
      event.preventDefault()
      onFiles(files)
    },
    onDragEnter(event) {
      if (disabled || !hasFiles(event.dataTransfer)) return
      dragDepth.current += 1
      if (dragDepth.current === 1) setDragging(true)
    },
    onDragOver(event) {
      if (disabled || !hasFiles(event.dataTransfer)) return
      // Without preventDefault the browser opens the dropped file instead.
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave() {
      if (disabled) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    },
    onDrop(event) {
      if (disabled) return
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = imageFilesFromDataTransfer(event.dataTransfer)
      if (files.length > 0) onFiles(files)
    },
  }
}

/** The accept attribute the hidden picker needs, kept next to the hook. */
export const IMAGE_INPUT_ACCEPT = IMAGE_ACCEPT
