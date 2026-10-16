/**
 * @file AgentRunRowMapper
 * @description Row ↔ domain mapping for the agent-run audit chain: the run
 * itself and the tool invocations it executed. Both live here because
 * `tool_invocation.run_id` owns the rows for provenance — a tool call without
 * a run is exactly the untraceable record the schema is built to prevent.
 *
 * Constraints:
 * - args_json and result_json carry the tool's argument and result documents
 *   verbatim as the envelope payload. The domain keeps them as opaque text
 *   because a tool's arguments are not a document model: re-serializing them
 *   through the mapper would rewrite bytes the user may read in an audit view.
 *   The envelope still applies — the column stores `{"v":1,"data":"…"}` and a
 *   bare `{}` is not a valid stored value.
 */

import { AGENT_RUN_STATUSES } from '../../../domain/generation/AgentRun'
import { APPROVAL_STATES } from '../../../domain/generation/ToolInvocation'
import { TOOL_RISKS } from '../../../domain/generation/ToolRisk'
import { parseDateTime } from '../../../domain/shared/DateTime'
import type { DateTime } from '../../../domain/shared/DateTime'
import { asAgentRunId, asJobPostingId, asResumeId, asToolInvocationId } from '../../../domain/shared/branded-id'
import type { AgentRun } from '../../../domain/generation/AgentRun'
import type { ToolInvocation } from '../../../domain/generation/ToolInvocation'
import { RowMappingError, readJsonStringEnvelope, writeJsonEnvelope } from './JsonEnvelope'

export interface AgentRunRow {
  readonly id: string
  readonly resume_id: string | null
  readonly job_posting_id: string | null
  readonly status: string
  readonly error_text: string | null
  readonly started_at: string
  readonly ended_at: string | null
}

export interface ToolInvocationRow {
  readonly id: string
  readonly run_id: string
  readonly tool_name: string
  readonly risk: string
  readonly args_json: string
  readonly result_json: string | null
  readonly approval_state: string
  readonly created_at: string
}

export function toAgentRunRow(run: AgentRun): AgentRunRow {
  return {
    id: run.id,
    resume_id: run.resumeId,
    job_posting_id: run.jobPostingId,
    status: run.status,
    error_text: run.errorText,
    started_at: run.startedAt,
    ended_at: run.endedAt,
  }
}

export function fromAgentRunRow(row: AgentRunRow): AgentRun {
  return {
    id: asAgentRunId(requiredText(row.id, 'agent_run.id')),
    resumeId:
      row.resume_id === null ? null : asResumeId(requiredText(row.resume_id, 'agent_run.resume_id')),
    jobPostingId:
      row.job_posting_id === null
        ? null
        : asJobPostingId(requiredText(row.job_posting_id, 'agent_run.job_posting_id')),
    status: requiredEnum(row.status, 'agent_run.status', AGENT_RUN_STATUSES),
    errorText: nullableText(row.error_text, 'agent_run.error_text'),
    startedAt: requiredTimestamp(row.started_at, 'agent_run.started_at'),
    endedAt: nullableTimestamp(row.ended_at, 'agent_run.ended_at'),
  }
}

export function toToolInvocationRow(invocation: ToolInvocation): ToolInvocationRow {
  return {
    id: invocation.id,
    run_id: invocation.runId,
    tool_name: invocation.toolName,
    risk: invocation.risk,
    args_json: writeJsonEnvelope(invocation.argsJson),
    result_json: invocation.resultJson === null ? null : writeJsonEnvelope(invocation.resultJson),
    approval_state: invocation.approvalState,
    created_at: invocation.createdAt,
  }
}

export function fromToolInvocationRow(row: ToolInvocationRow): ToolInvocation {
  return {
    id: asToolInvocationId(requiredText(row.id, 'tool_invocation.id')),
    runId: asAgentRunId(requiredText(row.run_id, 'tool_invocation.run_id')),
    toolName: requiredText(row.tool_name, 'tool_invocation.tool_name'),
    risk: requiredEnum(row.risk, 'tool_invocation.risk', TOOL_RISKS),
    argsJson: readJsonStringEnvelope(row.args_json, 'tool_invocation.args_json'),
    resultJson:
      row.result_json === null
        ? null
        : readJsonStringEnvelope(row.result_json, 'tool_invocation.result_json'),
    approvalState: requiredEnum(row.approval_state, 'tool_invocation.approval_state', APPROVAL_STATES),
    createdAt: requiredTimestamp(row.created_at, 'tool_invocation.created_at'),
  }
}

function requiredText(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new RowMappingError(column, 'expected text', value)
  }
  return value
}

function nullableText(value: unknown, column: string): string | null {
  if (value === null || value === undefined) return null
  return requiredText(value, column)
}

function requiredTimestamp(value: unknown, column: string): DateTime {
  const raw = requiredText(value, column)
  const parsed = parseDateTime(raw)
  if (parsed === null) {
    throw new RowMappingError(column, 'expected an ISO 8601 timestamp', raw)
  }
  return parsed
}

function nullableTimestamp(value: unknown, column: string): DateTime | null {
  if (value === null || value === undefined) return null
  return requiredTimestamp(value, column)
}

function requiredEnum<T extends string>(
  value: unknown,
  column: string,
  members: readonly T[],
): T {
  const raw = requiredText(value, column)
  if (!(members as readonly string[]).includes(raw)) {
    throw new RowMappingError(column, 'is not one of the permitted values', raw)
  }
  return raw as T
}
