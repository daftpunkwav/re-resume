/**
 * @file toolCardUndo.test
 * @description The undo rows of a tool card: a library write names its change,
 * a resume write names its revision, and a create-resume card offers neither —
 * it says the operation is not reversible instead.
 */

import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { ApplicationServicesProvider } from '../../../../src/presentation/app/ApplicationServicesProvider'
import { ToolCard } from '../../../../src/presentation/features/conversation/ToolCard'
import type { Message } from '../../../../src/domain/conversation/Message'
import { parseDateTime } from '../../../../src/domain/shared/DateTime'
import type { DateTime } from '../../../../src/domain/shared/DateTime'
import {
  asAgentRunId,
  asChangeRecordId,
  asConversationId,
  asMessageId,
  asResumeId,
  asRevisionId,
} from '../../../../src/domain/shared/branded-id'
import { stubCompositionRoot } from '../../../support/stubCompositionRoot'

const AT: DateTime = parseDateTime('2026-01-01T00:00:00.000Z') as DateTime

function toolMessage(overrides: {
  readonly toolName: string
  readonly changeIds?: readonly string[]
  readonly revisionId?: string | null
  readonly resumeId?: string | null
}): Message {
  return {
    id: asMessageId('message-tool'),
    conversationId: asConversationId('conversation-1'),
    seq: 2,
    kind: 'tool',
    status: 'complete',
    markdown: '',
    attachmentIds: [],
    runId: asAgentRunId('run-1'),
    errorText: null,
    createdAt: AT,
    updatedAt: AT,
    tool: {
      toolName: overrides.toolName,
      invocationId: null,
      risk: 'write',
      label: '工具',
      detail: '{"ok":true}',
      changeIds: (overrides.changeIds ?? []).map((id) => asChangeRecordId(id)),
      revisionId:
        overrides.revisionId === null || overrides.revisionId === undefined
          ? null
          : asRevisionId(overrides.revisionId),
      resumeId:
        overrides.resumeId === null || overrides.resumeId === undefined
          ? null
          : asResumeId(overrides.resumeId),
    },
  }
}

async function expand(message: Message): Promise<void> {
  render(
    <ApplicationServicesProvider
      createRoot={async () => stubCompositionRoot()}
      resolveSnapshotPath={async () => 'test.hold'}
    >
      <ToolCard message={message} />
    </ApplicationServicesProvider>,
  )
  fireEvent.click(await screen.findByRole('button'))
}

describe('the undo rows of a tool card', () => {
  it('offers undo for a library change', async () => {
    await expand(toolMessage({ toolName: 'createInfoEntry', changeIds: ['change-1'] }))
    expect(screen.getByRole('button', { name: /撤销此项/ })).toBeInTheDocument()
  })

  it('offers undo for a resume revision', async () => {
    await expand(
      toolMessage({
        toolName: 'writeResumeSummary',
        revisionId: 'revision-2',
        resumeId: 'resume-1',
      }),
    )
    expect(screen.getByRole('button', { name: /撤销此项/ })).toBeInTheDocument()
  })

  it('marks create-resume as irreversible and offers no undo', async () => {
    await expand(
      toolMessage({
        toolName: 'createResume',
        revisionId: 'revision-1',
        resumeId: 'resume-1',
      }),
    )
    expect(screen.getByText(/此操作不进入撤销历史/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /撤销此项/ })).toBeNull()
  })
})
