/**
 * @file AgentRun
 * @description One agent task and its lifecycle. awaitingConfirmation exists
 * for future destructive tools; with the v1 toolset it is unreachable.
 */

import type { DateTime } from '../shared/DateTime'
import type { AgentRunId, JobPostingId, ResumeId } from '../shared/branded-id'

export const AGENT_RUN_STATUSES = [
  'running',
  'awaitingConfirmation',
  'completed',
  'failed',
  'cancelled',
] as const

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number]

export interface AgentRun {
  readonly id: AgentRunId
  readonly resumeId: ResumeId | null
  readonly jobPostingId: JobPostingId | null
  readonly status: AgentRunStatus
  readonly errorText: string | null
  readonly startedAt: DateTime
  readonly endedAt: DateTime | null
}

export function isTerminal(status: AgentRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function completeRun(run: AgentRun, now: DateTime): AgentRun {
  return { ...run, status: 'completed', endedAt: now }
}

export function failRun(run: AgentRun, errorText: string, now: DateTime): AgentRun {
  return { ...run, status: 'failed', errorText, endedAt: now }
}
