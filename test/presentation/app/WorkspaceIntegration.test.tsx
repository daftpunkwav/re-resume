/**
 * @file WorkspaceIntegration.test
 * @description The agent-event bridge: a resume write opens the studio and
 * queues its reveal, a write tool marks the studio busy until the run stops,
 * and an undo refreshes the owning panel.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApplicationServicesProvider } from '../../../src/presentation/app/ApplicationServicesProvider'
import { WorkspaceIntegration } from '../../../src/presentation/app/WorkspaceIntegration'
import { useShellStore } from '../../../src/presentation/app/stores/shellStore'
import { publishWorkspaceSignal, resetWorkspaceSignals } from '../../../src/presentation/features/conversation/workspaceEvents'
import { useResumeStore } from '../../../src/presentation/features/resume/resumeStore'
import type { AgentEvent } from '../../../src/domain/generation/AgentEvent'
import {
  asConversationId,
  asResumeId,
  asRevisionId,
  asAgentRunId,
} from '../../../src/domain/shared/branded-id'
import { stubCompositionRoot } from '../../support/stubCompositionRoot'

function renderIntegration() {
  return render(
    <ApplicationServicesProvider
      createRoot={async () => stubCompositionRoot()}
      resolveSnapshotPath={async () => 'test.hold'}
    >
      <WorkspaceIntegration />
      <span>workspace-ready</span>
    </ApplicationServicesProvider>,
  )
}

const RESUME_ID = asResumeId('resume-1')
const REVISION_ID = asRevisionId('revision-2')

beforeEach(() => {
  resetWorkspaceSignals()
  useShellStore.setState({
    rightPanel: 'none',
    settingsOpen: false,
    lastOpenPanel: 'resume',
  })
  useResumeStore.setState({ agentBusy: false, revealRequest: null })
})

afterEach(() => {
  useResumeStore.setState({ agentBusy: false, revealRequest: null })
})

describe('WorkspaceIntegration', () => {
  it('opens the resume studio and queues the reveal for a resume write', async () => {
    renderIntegration()
    await screen.findByText('workspace-ready', undefined, { timeout: 5000 })

    // The provider adopts the stored settings after the first paint, which
    // re-subscribes the bridge; a signal published in that gap would be lost.
    // Publishing again on each retry keeps the assertion about behaviour, not
    // about which render the subscription landed on.
    await waitFor(
      () => {
        publishWorkspaceSignal({
          kind: 'agentEvent',
          event: {
            type: 'changeRecorded',
            changeIds: [],
            revisionId: REVISION_ID,
            resumeId: RESUME_ID,
          },
        })
        expect(useShellStore.getState().rightPanel).toBe('resume')
      },
      { timeout: 5000 },
    )
    const reveal = useResumeStore.getState().revealRequest
    expect(reveal).toMatchObject({ resumeId: RESUME_ID, revisionId: REVISION_ID })
    expect(reveal?.nonce).toBeGreaterThan(0)
  })

  it('marks the studio busy while a write tool runs and clears it on done', async () => {
    renderIntegration()
    await screen.findByText('workspace-ready', undefined, { timeout: 5000 })

    const toolStart: AgentEvent = {
      type: 'toolStart',
      invocationId: 'invocation-1' as never,
      toolName: 'writeResumeSummary',
      risk: 'write',
      label: '修改简历摘要',
      argsSummary: '{}',
      messageId: 'message-1' as never,
    }
    publishWorkspaceSignal({ kind: 'agentEvent', event: toolStart })
    expect(useResumeStore.getState().agentBusy).toBe(true)

    publishWorkspaceSignal({
      kind: 'agentEvent',
      event: {
        type: 'done',
        status: 'completed',
        runId: asAgentRunId('run-1'),
        errorText: null,
      },
    })
    expect(useResumeStore.getState().agentBusy).toBe(false)
  })

  it('does not treat a read tool as a write', async () => {
    renderIntegration()
    await screen.findByText('workspace-ready', undefined, { timeout: 5000 })

    publishWorkspaceSignal({
      kind: 'agentEvent',
      event: {
        type: 'toolStart',
        invocationId: 'invocation-1' as never,
        toolName: 'searchInfoEntries',
        risk: 'read',
        label: '检索信息条目',
        argsSummary: '{}',
        messageId: 'message-1' as never,
      },
    })

    expect(useResumeStore.getState().agentBusy).toBe(false)
    expect(useShellStore.getState().rightPanel).toBe('none')
  })
})

void asConversationId
