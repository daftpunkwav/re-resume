/**
 * @file AgentRun
 * @description One agent turn and its lifecycle: running, then completed,
 * failed or cancelled. The run is the audit anchor for every tool invocation
 * and every change record the turn produced.
 *
 * Responsibilities:
 * - Declare the persisted shape and the four permitted statuses
 * - Provide the pure transitions the run loop applies when it finishes
 *
 * Constraints:
 * - This module is pure: no DOM, no storage, no package.
 * - A run is never deleted and never returns to running; the interface reads
 *   the last terminal state to decide whether a retry is offered.
 */

import type { DateTime } from '../shared/DateTime'
import type { AgentRunId, ConversationId, JobPostingId, ResumeId } from '../shared/branded-id'

export const AGENT_RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]

export interface AgentRun {
  readonly id: AgentRunId
  readonly conversationId: ConversationId | null
  readonly resumeId: ResumeId | null
  readonly jobPostingId: JobPostingId | null
  readonly status: AgentRunStatus
  readonly errorText: string | null
  readonly promptTokens: number | null
  readonly completionTokens: number | null
  readonly startedAt: DateTime
  readonly endedAt: DateTime | null
}

export function isAgentRunStatus(value: unknown): value is AgentRunStatus {
  return typeof value === 'string' && (AGENT_RUN_STATUSES as readonly string[]).includes(value)
}

export function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/** Ends a run that produced its answer. */
export function completeRun(run: AgentRun, now: DateTime): AgentRun {
  return { ...run, status: 'completed', errorText: null, endedAt: now }
}

/** Ends a run that could not produce an answer. `errorText` must be redacted. */
export function failRun(run: AgentRun, errorText: string, now: DateTime): AgentRun {
  return { ...run, status: 'failed', errorText, endedAt: now }
}

/** Ends a run the user stopped. Partial output stays on the assistant message. */
export function cancelAgentRun(run: AgentRun, now: DateTime, errorText = '已取消'): AgentRun {
  return { ...run, status: 'cancelled', errorText, endedAt: now }
}

/**
 * Adds the tokens reported by one provider call to the run. Usage frames may
 * arrive once per request; a run spans several requests, so the counters are
 * accumulated rather than overwritten.
 */
export function recordRunUsage(
  run: AgentRun,
  usage: { readonly promptTokens: number; readonly completionTokens: number },
): AgentRun {
  return {
    ...run,
    promptTokens: (run.promptTokens ?? 0) + usage.promptTokens,
    completionTokens: (run.completionTokens ?? 0) + usage.completionTokens,
  }
}
