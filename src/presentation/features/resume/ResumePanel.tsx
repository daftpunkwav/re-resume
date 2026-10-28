/**
 * @file ResumePanel
 * @description The resume studio as the right-hand dock mounts it. The panel
 * chooses among its loading, failed, empty and ready states and starts the
 * lifecycle and keyboard hooks; the ready layout and each region live in their
 * own components.
 *
 * Constraints:
 * - The panel unmounts when the dock closes (the dock does not hide features),
 *   so every store subscription and window listener is mounted with it.
 * - No document rule lives here: the store calls the use cases and the use cases
 *   validate.
 */

import { useState } from 'react'

import type { Resume } from '../../../domain/resume/Resume'

import { useServices } from '../../app/ApplicationServicesProvider'
import { useResumeStore } from './resumeStore'
import {
  StudioEmptyState,
  StudioListErrorNotice,
  StudioMissingResume,
  StudioResumeErrorNotice,
  StudioSkeleton,
} from './ResumePanelStates'
import { ResumePanelReady } from './ResumePanelReady'
import { resumePanelStateOf } from './resumePanelState'
import { useResumeAgentReveal } from './agentReveal'
import { useStudioBootstrap, useStudioUndoShortcuts } from './useResumePanelLifecycle'
import './resume.css'

export interface ResumePanelProps {
  /** Adds the open resume to the next turn; absent when the shell has no caller. */
  readonly onAddResumeToConversation?: (resume: Resume) => void
}

export function ResumePanel({ onAddResumeToConversation }: ResumePanelProps = {}) {
  const services = useServices()
  const list = useResumeStore((state) => state.list)
  const listStatus = useResumeStore((state) => state.listStatus)
  const listError = useResumeStore((state) => state.listError)
  const loadStatus = useResumeStore((state) => state.loadStatus)
  const loadError = useResumeStore((state) => state.loadError)
  const resume = useResumeStore((state) => state.resume)
  const activeTab = useResumeStore((state) => state.activeTab)
  const setActiveTab = useResumeStore((state) => state.setActiveTab)
  const [createOpen, setCreateOpen] = useState(false)

  useStudioBootstrap({ resume: services.resume, info: services.info })
  useStudioUndoShortcuts()
  useResumeAgentReveal()

  const state = resumePanelStateOf({
    listStatus,
    listLength: list.length,
    loadStatus,
    resume,
  })

  if (state === 'loading') return <StudioSkeleton />
  if (state === 'list-error') {
    return (
      <StudioListErrorNotice
        message={listError?.message ?? '请重试。'}
        onRetry={() => void useResumeStore.getState().loadInitial()}
      />
    )
  }
  if (state === 'resume-error') {
    return (
      <StudioResumeErrorNotice
        message={loadError?.message ?? '请重试。'}
        onRetry={() => {
          const store = useResumeStore.getState()
          if (store.selectedId !== null) void store.select(store.selectedId)
          else void store.loadInitial()
        }}
      />
    )
  }
  if (state === 'empty') {
    return (
      <StudioEmptyState
        createOpen={createOpen}
        onCreateOpen={() => setCreateOpen(true)}
        onCreateClose={() => setCreateOpen(false)}
      />
    )
  }
  if (resume === null) return <StudioMissingResume />
  return (
    <ResumePanelReady
      resume={resume}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onAddToConversation={onAddResumeToConversation}
    />
  )
}
