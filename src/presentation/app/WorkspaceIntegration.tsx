/**
 * @file WorkspaceIntegration
 * @description The one component that turns assistant activity into workspace
 * behaviour: it refreshes the panel a write landed in, opens that panel, asks it
 * to flash the changed object, and keeps the agent-busy marker honest.
 *
 * Responsibilities:
 * - Reduce the workspace signals of one turn into panel reveals
 * - Open the owning panel without collapsing the other one
 * - Mark the resume studio busy while a write is running and clear it when the
 *   run stops, fails or finishes
 * - Refresh the panel stores after an undo changed the stored value
 *
 * Constraints:
 * - It renders nothing and owns no UI state; every effect is a store or
 *   capability call.
 * - A missing target is not an error: the turn simply has no place to point at.
 */

import { useEffect } from 'react'
import type { AgentEvent } from '../../domain/generation/AgentEvent'
import type { CustomModuleId, InfoEntryId } from '../../domain/shared/branded-id'
import type { CompositionRoot } from '../../bootstrap/capabilities'
import { useServices } from './ApplicationServicesProvider'
import { isInfoStoreConnected, useInfoStore } from '../features/info/stores/infoStore'
import { useResumeStore } from '../features/resume/resumeStore'
import { showPanel } from '../features/conversation/revealChange'
import { subscribeWorkspaceSignals } from '../features/conversation/workspaceEvents'
import type { WorkspaceSignal } from '../features/conversation/workspaceEvents'

/** How many change records one reveal resolves; a burst is one write round. */
const REVEAL_CHANGE_LIMIT = 10

async function revealAgentWrite(
  services: CompositionRoot,
  event: Extract<AgentEvent, { type: 'changeRecorded' }>,
): Promise<void> {
  if (event.resumeId !== null) {
    showPanel('resume')
    useResumeStore
      .getState()
      .requestAgentReveal({ resumeId: event.resumeId, revisionId: event.revisionId })
    return
  }
  if (event.changeIds.length === 0) return
  const records = await Promise.all(
    event.changeIds
      .slice(0, REVEAL_CHANGE_LIMIT)
      .map((changeId) => services.libraryChanges.readChange(changeId).catch(() => null)),
  )
  const found = records.filter((record) => record !== null)
  if (found.length === 0) return
  const entryIds = found
    .filter((record) => record.entity === 'infoEntry')
    .map((record) => record.entityId as InfoEntryId)
  const customModule = found.find((record) => record.entity === 'customModule')
  showPanel('info')
  useInfoStore.getState().requestReveal({
    entryIds,
    customModuleId:
      customModule === undefined ? null : (customModule.entityId as CustomModuleId),
  })
}

function applyUndo(scope: 'library' | 'resume'): void {
  if (scope === 'library' && isInfoStoreConnected()) {
    void useInfoStore.getState().refresh()
    return
  }
  if (scope === 'resume' && useResumeStore.getState().services !== null) {
    void useResumeStore.getState().reload()
  }
}

function applyAgentEvent(services: CompositionRoot, event: AgentEvent): void {
  switch (event.type) {
    case 'toolStart':
      // Both a library write and a resume draft change the panels; the bar says
      // the agent is writing, so a draft counts as much as a direct write.
      if (event.risk !== 'read') useResumeStore.getState().setAgentBusy(true)
      return
    case 'changeRecorded':
      void revealAgentWrite(services, event)
      return
    case 'done':
    case 'error':
      useResumeStore.getState().setAgentBusy(false)
      return
    default:
      return
  }
}

function applySignal(services: CompositionRoot, signal: WorkspaceSignal): void {
  if (signal.kind === 'agentEvent') applyAgentEvent(services, signal.event)
  else applyUndo(signal.scope)
}

export function WorkspaceIntegration() {
  const services = useServices()
  useEffect(() => subscribeWorkspaceSignals((signal) => applySignal(services, signal)), [services])
  return null
}
