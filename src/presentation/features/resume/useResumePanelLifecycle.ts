/**
 * @file useResumePanelLifecycle
 * @description The two side effects the studio panel owns while it is mounted:
 * binding the studio store to the application services and the document undo
 * shortcuts. Closing the dock unmounts the panel, so both live exactly as long
 * as the feature is visible.
 */

import { useEffect } from 'react'

import type { InfoService, ResumeService } from '../../../bootstrap/capabilities'
import { isEditableTarget } from '../../app/shortcuts'
import { useResumeStore } from './resumeStore'

export interface ResumeStudioServices {
  readonly resume: ResumeService
  readonly info: InfoService
}

/** Binds the store, loads the list and detaches on unmount. */
export function useStudioBootstrap(services: ResumeStudioServices): void {
  const { resume, info } = services
  useEffect(() => {
    const store = useResumeStore.getState()
    store.attach({ resume, info })
    void store.loadInitial()
    return () => {
      useResumeStore.getState().detach()
    }
  }, [resume, info])
}

function isDialogTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"]') !== null
}

function isUndoKey(event: KeyboardEvent): boolean {
  if (event.isComposing || isEditableTarget(event.target) || isDialogTarget(event.target)) return false
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false
  if (event.key.toLowerCase() !== 'z') return false
  const resume = useResumeStore.getState().resume
  return resume !== null && resume.status !== 'frozen'
}

function applyUndoKey(event: KeyboardEvent): void {
  event.preventDefault()
  if (event.shiftKey) void useResumeStore.getState().redo()
  else void useResumeStore.getState().undo()
}

/** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z for the document, unless the user is typing. */
export function useStudioUndoShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isUndoKey(event)) return
      applyUndoKey(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
