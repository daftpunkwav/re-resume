/**
 * @file toolOutcome
 * @description The conventions shared by the run loop and the tool pack: how a
 * tool result is wrapped for the model, which identifiers it names for the audit
 * row, and how much of it is stored.
 *
 * Responsibilities:
 * - Wrap a successful value and a failure message in the two envelope shapes
 * - Read the change/revision identifiers a tool result reports
 * - Cap both the text handed back to the model and the text stored in a row
 *
 * Constraints:
 * - The outcome identifiers are read by name from the result document, so the
 *   tool port stays free of an extra reporting method; the names are the ones
 *   the tool table already promises (`changeId`, `changeIds`, `revisionId`,
 *   `resumeId`).
 */

import type { ChangeRecordId, ResumeId, RevisionId } from '../../domain/shared/branded-id'
import {
  asChangeRecordId,
  asResumeId,
  asRevisionId,
} from '../../domain/shared/branded-id'

/** Characters of one tool result handed back to the model. */
export const TOOL_RESULT_CHARACTER_LIMIT = 8000

/** Characters of the summary a tool card and an event carry. */
export const TOOL_SUMMARY_CHARACTER_LIMIT = 400

export interface ToolOutcomeMetadata {
  readonly changeIds: readonly ChangeRecordId[]
  readonly revisionId: RevisionId | null
  readonly resumeId: ResumeId | null
}

export const EMPTY_TOOL_OUTCOME: ToolOutcomeMetadata = {
  changeIds: [],
  revisionId: null,
  resumeId: null,
}

export function successResultJson(value: unknown): string {
  return JSON.stringify({ ok: true, value })
}

export function failureResultJson(error: string): string {
  return JSON.stringify({ ok: false, error })
}

/** Reads the identifiers a tool result reports, ignoring anything malformed. */
export function readToolOutcomeMetadata(value: unknown): ToolOutcomeMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return EMPTY_TOOL_OUTCOME
  }
  const record = value as Record<string, unknown>
  const changeIds = readChangeIds(record.changeIds, record.changeId)
  const revisionId = readIdentifier(record.revisionId, asRevisionId)
  const resumeId = readIdentifier(record.resumeId, asResumeId)
  return { changeIds, revisionId, resumeId }
}

/** Caps the text fed back to the model. The model still sees what was cut. */
export function truncateToolResult(content: string): string {
  const codePoints = [...content]
  if (codePoints.length <= TOOL_RESULT_CHARACTER_LIMIT) return content
  return `${codePoints.slice(0, TOOL_RESULT_CHARACTER_LIMIT - 1).join('')}…`
}

/** Caps the one-line summary a tool card and an event carry. */
export function summarizeToolOutcome(content: string): string {
  const codePoints = [...content]
  if (codePoints.length <= TOOL_SUMMARY_CHARACTER_LIMIT) return content
  return `${codePoints.slice(0, TOOL_SUMMARY_CHARACTER_LIMIT - 1).join('')}…`
}

function readChangeIds(changeIds: unknown, singleChangeId: unknown): readonly ChangeRecordId[] {
  if (Array.isArray(changeIds)) {
    return changeIds.filter((id): id is string => typeof id === 'string').map(asChangeRecordId)
  }
  return typeof singleChangeId === 'string' ? [asChangeRecordId(singleChangeId)] : []
}

function readIdentifier<T>(value: unknown, reconstruct: (raw: string) => T): T | null {
  return typeof value === 'string' && value !== '' ? reconstruct(value) : null
}
