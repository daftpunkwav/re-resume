/**
 * @file toolExecution
 * @description Execution of one tool call the model requested: argument parsing,
 * timeout, audit row, and the event pair the interface consumes.
 *
 * Responsibilities:
 * - Refuse an unregistered tool without failing the run
 * - Parse arguments through the tool's own parser, so a malformed call is an
 *   expected outcome the model can correct
 * - Record the invocation before and after execution so a crash inside a tool
 *   still leaves an audit row
 * - Return the text fed back to the model on the next turn
 *
 * Constraints:
 * - Every persisted string is scrubbed of the configured credentials before it
 *   reaches a row or an event.
 * - A thrown DomainError is reported as a failed call the model can react to;
 *   any other throw is a programming or infrastructure fault and is reported to
 *   the run loop, which ends the run.
 * - A cancellation that arrives while a tool runs does not interrupt it: the
 *   call is bounded by its own timeout, and letting it finish keeps the audit
 *   row truthful about what was written.
 */

import type { Message } from '../../domain/conversation/Message'
import type { AgentEvent } from '../../domain/generation/AgentEvent'
import type { ToolInvocation } from '../../domain/generation/ToolInvocation'
import type {
  RegisteredTool,
  ToolContext,
  ToolRegistry,
} from '../../domain/generation/ports/ToolRegistry'
import { DomainError } from '../../domain/shared/DomainError'
import type { Clock } from '../../domain/shared/Clock'
import type { IdGenerator } from '../../domain/shared/IdGenerator'
import type { AgentRunId } from '../../domain/shared/branded-id'
import { asToolInvocationId } from '../../domain/shared/branded-id'
import { redactJsonSecrets, redactSecret } from './redactSecret'
import { summarizeToolArgs } from './toolArgsSummary'
import {
  EMPTY_TOOL_OUTCOME,
  failureResultJson,
  readToolOutcomeMetadata,
  summarizeToolOutcome,
  successResultJson,
  truncateToolResult,
} from './toolOutcome'
import type { ToolOutcomeMetadata } from './toolOutcome'

/** Longest summary string carried by a toolEnd event. */
const TOOL_EVENT_SUMMARY_LIMIT = 400

/** Raised when a tool exceeds its own timeout. Treated as a failed call. */
class ToolTimeoutError extends Error {
  constructor(toolName: string, milliseconds: number) {
    super(`工具「${toolName}」执行超时（${milliseconds} ms）。`)
    this.name = 'ToolTimeoutError'
  }
}

export interface ExecuteToolCallDeps {
  readonly registry: ToolRegistry
  readonly invocations: { record(invocation: ToolInvocation): Promise<void> }
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly emit: (event: AgentEvent) => void
  readonly secrets: readonly string[]
  readonly toolTimeoutMs: number
}

export interface ExecuteToolCallInput {
  readonly runId: AgentRunId
  readonly message: Message
  readonly toolName: string
  readonly argsJson: string
  readonly context: ToolContext
}

export interface ToolCallOutcome {
  /** Text handed back to the model as the tool result part. */
  readonly content: string
  readonly status: 'ok' | 'failed'
  readonly metadata: ToolOutcomeMetadata
  /** The audit row, or null when the tool was not registered and no row exists. */
  readonly invocationId: ToolInvocation['id'] | null
  /** Set only for a fault that must end the run. */
  readonly fault?: string
}

/**
 * Runs one call. The caller has created the tool message in `running` state and
 * owns its final update; this function records the invocation and emits the
 * tool events.
 */
export async function executeToolCall(
  deps: ExecuteToolCallDeps,
  input: ExecuteToolCallInput,
): Promise<ToolCallOutcome> {
  const tool = deps.registry.get(input.toolName)
  const label = deps.registry.labelFor(input.toolName)
  const invocationId = asToolInvocationId(deps.ids.next())
  const argsSummary = summarizeToolArgs(input.argsJson, deps.secrets)

  if (tool === undefined) {
    deps.emit({
      type: 'toolStart',
      invocationId,
      toolName: input.toolName,
      risk: 'read',
      label,
      argsSummary,
      messageId: input.message.id,
    })
    const content = failureResultJson(`没有名为「${input.toolName}」的工具。`)
    deps.emit({
      type: 'toolEnd',
      invocationId,
      status: 'failed',
      summary: summarizeToolOutcome(content),
      messageId: input.message.id,
      changeIds: [],
      revisionId: null,
      resumeId: null,
    })
    return { content, status: 'failed', metadata: EMPTY_TOOL_OUTCOME, invocationId: null }
  }

  deps.emit({
    type: 'toolStart',
    invocationId,
    toolName: tool.name,
    risk: tool.risk,
    label,
    argsSummary,
    messageId: input.message.id,
  })

  const invocation: ToolInvocation = {
    id: invocationId,
    runId: input.runId,
    messageId: input.message.id,
    toolName: tool.name,
    risk: tool.risk,
    argsJson: redactJsonSecrets(input.argsJson, deps.secrets),
    resultSummaryJson: null,
    changeIds: [],
    revisionId: null,
    status: 'failed',
    createdAt: deps.clock.now(),
  }
  await deps.invocations.record(invocation)

  const parsed = parseToolArguments(tool, input.argsJson)
  if (!parsed.ok) {
    return finishFailed(deps, input, invocation, parsed.error)
  }

  let value: unknown
  try {
    value = await withTimeout(
      tool.execute(parsed.value, input.context),
      deps.toolTimeoutMs,
      tool.name,
    )
  } catch (failure) {
    if (failure instanceof DomainError) {
      return finishFailed(deps, input, invocation, `${failure.code}: ${failure.message}`)
    }
    if (failure instanceof ToolTimeoutError) {
      return finishFailed(deps, input, invocation, failure.message)
    }
    const fault = describeThrown(failure)
    await recordFailure(deps, invocation, failureResultJson(fault))
    deps.emit({
      type: 'toolEnd',
      invocationId,
      status: 'failed',
      summary: redactSecret(truncateText(fault, TOOL_EVENT_SUMMARY_LIMIT), deps.secrets),
      messageId: input.message.id,
      changeIds: [],
      revisionId: null,
      resumeId: null,
    })
    return {
      content: failureResultJson(fault),
      status: 'failed',
      metadata: EMPTY_TOOL_OUTCOME,
      invocationId: invocation.id,
      fault: redactSecret(fault, deps.secrets),
    }
  }

  const refusal = readToolRefusal(value)
  if (refusal !== null) {
    return finishFailed(deps, input, invocation, refusal)
  }

  const metadata = readToolOutcomeMetadata(value)
  const content = truncateToolResult(successResultJson(value))
  await deps.invocations.record({
    ...invocation,
    resultSummaryJson: truncateToolResult(redactJsonSecrets(successResultJson(value), deps.secrets)),
    changeIds: metadata.changeIds,
    revisionId: metadata.revisionId,
    status: 'ok',
  })
  deps.emit({
    type: 'toolEnd',
    invocationId,
    status: 'ok',
    summary: summarizeToolOutcome(content),
    messageId: input.message.id,
    changeIds: metadata.changeIds,
    revisionId: metadata.revisionId,
    resumeId: metadata.resumeId,
  })
  if (metadata.changeIds.length > 0 || metadata.revisionId !== null) {
    deps.emit({
      type: 'changeRecorded',
      changeIds: metadata.changeIds,
      revisionId: metadata.revisionId,
      resumeId: metadata.resumeId,
    })
  }
  return { content, status: 'ok', metadata, invocationId: invocation.id }
}

async function finishFailed(
  deps: ExecuteToolCallDeps,
  input: ExecuteToolCallInput,
  invocation: ToolInvocation,
  error: string,
): Promise<ToolCallOutcome> {
  const content = failureResultJson(error)
  await recordFailure(deps, invocation, content)
  deps.emit({
    type: 'toolEnd',
    invocationId: invocation.id,
    status: 'failed',
    summary: summarizeToolOutcome(content),
    messageId: input.message.id,
    changeIds: [],
    revisionId: null,
    resumeId: null,
  })
  return { content, status: 'failed', metadata: EMPTY_TOOL_OUTCOME, invocationId: invocation.id }
}

async function recordFailure(
  deps: ExecuteToolCallDeps,
  invocation: ToolInvocation,
  content: string,
): Promise<void> {
  await deps.invocations.record({
    ...invocation,
    resultSummaryJson: truncateToolResult(redactJsonSecrets(content, deps.secrets)),
    status: 'failed',
  })
}

function parseToolArguments(
  tool: RegisteredTool<unknown, unknown>,
  argsJson: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string } {
  let decoded: unknown
  try {
    decoded = JSON.parse(argsJson) as unknown
  } catch (failure) {
    return { ok: false, error: `参数不是合法的 JSON：${describeThrown(failure)}` }
  }
  const parsed = tool.parse(decoded)
  if (parsed.ok) return { ok: true, value: parsed.value }
  return { ok: false, error: describeFailure(parsed.error) }
}

function describeFailure(error: unknown): string {
  if (error instanceof DomainError) return `${error.code}: ${error.message}`
  return describeThrown(error)
}

/**
 * Reads the refusal a tool returns instead of throwing: the model-facing
 * `{ ok:false, error }` value the domain mapping produces. A refusal is a
 * failed call, so the card and the audit row say so, while the run continues.
 */
function readToolRefusal(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as { readonly ok?: unknown; readonly error?: unknown }
  if (candidate.ok !== false || typeof candidate.error !== 'string') return null
  return candidate.error
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function truncateText(text: string, limit: number): string {
  const codePoints = [...text]
  return codePoints.length <= limit ? text : `${codePoints.slice(0, limit - 1).join('')}…`
}

async function withTimeout<T>(
  work: Promise<T>,
  milliseconds: number,
  toolName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(toolName, milliseconds)), milliseconds)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
