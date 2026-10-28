/**
 * @file AgentRunRowMapper
 * @description Row to domain conversion for runs and the tool invocations they
 * executed. Both live here because a tool invocation only means something in
 * the context of the run that produced it.
 *
 * Constraints:
 * - `args_json` and `result_summary_json` store the redacted text inside the
 *   shared JSON envelope, so a bare JSON document written into the column is
 *   reported rather than read.
 */

import { isAgentRunStatus } from '../../../../domain/generation/AgentRun'
import type { AgentRun } from '../../../../domain/generation/AgentRun'
import { isToolInvocationStatus } from '../../../../domain/generation/ToolInvocation'
import type { ToolInvocation } from '../../../../domain/generation/ToolInvocation'
import { isToolRisk } from '../../../../domain/generation/ToolRisk'
import type { DateTime } from '../../../../domain/shared/DateTime'
import {
  asAgentRunId,
  asChangeRecordId,
  asConversationId,
  asJobPostingId,
  asMessageId,
  asResumeId,
  asRevisionId,
  asToolInvocationId,
} from '../../../../domain/shared/branded-id'
import {
  RowMappingError,
  readJsonArrayEnvelope,
  readJsonStringEnvelope,
  writeJsonEnvelope,
} from '../../JsonEnvelope'
import {
  nullableIdentifier,
  nullableInteger,
  nullableText,
  nullableTimestamp,
  requiredText,
  requiredTimestamp,
} from './ConversationRowMapper'

export interface AgentRunRow {
  readonly id: unknown
  readonly conversation_id: unknown
  readonly resume_id: unknown
  readonly job_posting_id: unknown
  readonly status: unknown
  readonly error_text: unknown
  readonly prompt_tokens: unknown
  readonly completion_tokens: unknown
  readonly started_at: unknown
  readonly ended_at: unknown
}

export interface ToolInvocationRow {
  readonly id: unknown
  readonly run_id: unknown
  readonly message_id: unknown
  readonly tool_name: unknown
  readonly risk: unknown
  readonly args_json: unknown
  readonly result_summary_json: unknown
  readonly change_ids_json: unknown
  readonly revision_id: unknown
  readonly status: unknown
  readonly created_at: unknown
}

export function toAgentRunRow(run: AgentRun): {
  readonly id: string
  readonly conversation_id: string | null
  readonly resume_id: string | null
  readonly job_posting_id: string | null
  readonly status: string
  readonly error_text: string | null
  readonly prompt_tokens: number | null
  readonly completion_tokens: number | null
  readonly started_at: DateTime
  readonly ended_at: DateTime | null
} {
  return {
    id: run.id,
    conversation_id: run.conversationId,
    resume_id: run.resumeId,
    job_posting_id: run.jobPostingId,
    status: run.status,
    error_text: run.errorText,
    prompt_tokens: run.promptTokens,
    completion_tokens: run.completionTokens,
    started_at: run.startedAt,
    ended_at: run.endedAt,
  }
}

export function fromAgentRunRow(row: AgentRunRow): AgentRun {
  const status = row.status
  if (!isAgentRunStatus(status)) {
    throw new RowMappingError('agent_run.status', 'value is not one of the run statuses', status)
  }
  const startedAt = requiredTimestamp(row.started_at, 'agent_run.started_at')
  const endedAt = nullableTimestamp(row.ended_at, 'agent_run.ended_at')
  if (status !== 'running' && endedAt === null) {
    throw new RowMappingError('agent_run.ended_at', 'a finished run must record when it ended', row.ended_at)
  }
  return {
    id: asAgentRunId(requiredText(row.id, 'agent_run.id')),
    conversationId: nullableIdentifier(row.conversation_id, 'agent_run.conversation_id', asConversationId),
    resumeId: nullableIdentifier(row.resume_id, 'agent_run.resume_id', asResumeId),
    jobPostingId: nullableIdentifier(row.job_posting_id, 'agent_run.job_posting_id', asJobPostingId),
    status,
    errorText: nullableText(row.error_text, 'agent_run.error_text'),
    promptTokens: nullableInteger(row.prompt_tokens, 'agent_run.prompt_tokens'),
    completionTokens: nullableInteger(row.completion_tokens, 'agent_run.completion_tokens'),
    startedAt,
    endedAt,
  }
}

export function toToolInvocationRow(invocation: ToolInvocation): {
  readonly id: string
  readonly run_id: string
  readonly message_id: string | null
  readonly tool_name: string
  readonly risk: string
  readonly args_json: string
  readonly result_summary_json: string | null
  readonly change_ids_json: string
  readonly revision_id: string | null
  readonly status: string
  readonly created_at: DateTime
} {
  return {
    id: invocation.id,
    run_id: invocation.runId,
    message_id: invocation.messageId,
    tool_name: invocation.toolName,
    risk: invocation.risk,
    args_json: writeJsonEnvelope(invocation.argsJson),
    result_summary_json:
      invocation.resultSummaryJson === null ? null : writeJsonEnvelope(invocation.resultSummaryJson),
    change_ids_json: writeJsonEnvelope([...invocation.changeIds]),
    revision_id: invocation.revisionId,
    status: invocation.status,
    created_at: invocation.createdAt,
  }
}

export function fromToolInvocationRow(row: ToolInvocationRow): ToolInvocation {
  const risk = row.risk
  if (!isToolRisk(risk)) {
    throw new RowMappingError('tool_invocation.risk', 'value is not one of the tool risks', risk)
  }
  const status = row.status
  if (!isToolInvocationStatus(status)) {
    throw new RowMappingError('tool_invocation.status', 'value is not one of the invocation statuses', status)
  }
  const changeIds = readJsonArrayEnvelope(row.change_ids_json, 'tool_invocation.change_ids_json')
  if (changeIds.some((id) => typeof id !== 'string')) {
    throw new RowMappingError(
      'tool_invocation.change_ids_json',
      'expected an array of identifiers',
      changeIds,
    )
  }
  return {
    id: asToolInvocationId(requiredText(row.id, 'tool_invocation.id')),
    runId: asAgentRunId(requiredText(row.run_id, 'tool_invocation.run_id')),
    messageId: nullableIdentifier(row.message_id, 'tool_invocation.message_id', asMessageId),
    toolName: requiredText(row.tool_name, 'tool_invocation.tool_name'),
    risk,
    argsJson: readJsonStringEnvelope(row.args_json, 'tool_invocation.args_json'),
    resultSummaryJson:
      row.result_summary_json === null
        ? null
        : readJsonStringEnvelope(row.result_summary_json, 'tool_invocation.result_summary_json'),
    changeIds: changeIds.map((id) => asChangeRecordId(String(id))),
    revisionId: nullableIdentifier(row.revision_id, 'tool_invocation.revision_id', asRevisionId),
    status,
    createdAt: requiredTimestamp(row.created_at, 'tool_invocation.created_at'),
  }
}
