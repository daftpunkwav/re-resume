/**
 * @file resumePanelState
 * @description Decides which of the studio panel's states is on screen. The
 * conditions are named so the panel component reads as one branch per state
 * instead of one compound expression per combination.
 */

import type { useResumeStore } from './resumeStore'

type StudioState = ReturnType<typeof useResumeStore.getState>

export type ResumePanelState =
  | 'loading'
  | 'list-error'
  | 'resume-error'
  | 'empty'
  | 'missing-resume'
  | 'ready'

export interface ResumePanelStateInput {
  readonly listStatus: StudioState['listStatus']
  readonly listLength: number
  readonly loadStatus: StudioState['loadStatus']
  readonly resume: StudioState['resume']
}

function isLoading(input: ResumePanelStateInput): boolean {
  if (input.listLength === 0 && (input.listStatus === 'loading' || input.listStatus === 'idle')) {
    return true
  }
  return input.resume === null && input.loadStatus === 'loading' && input.listLength > 0
}

function failedResume(input: ResumePanelStateInput): boolean {
  return input.resume === null && input.loadStatus === 'error' && input.listLength > 0
}

function failedList(input: ResumePanelStateInput): boolean {
  return input.listStatus === 'error' && input.listLength === 0
}

function emptyList(input: ResumePanelStateInput): boolean {
  return input.listStatus === 'ready' && input.listLength === 0
}

/** The first state whose condition matches, in the panel's original order. */
export function resumePanelStateOf(input: ResumePanelStateInput): ResumePanelState {
  if (isLoading(input)) return 'loading'
  if (failedResume(input)) return 'resume-error'
  if (failedList(input)) return 'list-error'
  if (emptyList(input)) return 'empty'
  if (input.resume === null) return 'missing-resume'
  return 'ready'
}

